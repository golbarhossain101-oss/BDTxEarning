```javascript
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {

    // ========================================
    // ONLY POST REQUEST
    // ========================================

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method Not Allowed'
        });
    }

    try {

        // ========================================
        // ENVIRONMENT VARIABLES
        // ========================================

        const BOT_TOKEN = process.env.BOT_TOKEN;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

        if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            console.error('Missing environment variables');

            return res.status(500).json({
                error: 'Server configuration error'
            });
        }

        const supabase = createClient(
            SUPABASE_URL,
            SUPABASE_SERVICE_KEY
        );

        // ========================================
        // TELEGRAM UPDATE
        // ========================================

        const update = req.body;

        const message =
            update?.message ||
            update?.edited_message ||
            update?.channel_post;

        if (!message) {
            return res.status(200).json({
                ok: true,
                message: 'No message'
            });
        }

        // ========================================
        // GET TEXT / CAPTION
        // ========================================

        // Works for:
        // Normal text
        // Photo caption
        // Video caption
        // GIF caption
        // Document caption
        // Animation caption

        const originalText =
            message.text ||
            message.caption ||
            '';

        if (!originalText || !originalText.trim()) {
            return res.status(200).json({
                ok: true,
                message: 'No text or caption'
            });
        }

        // ========================================
        // /START
        // ========================================

        if (originalText.trim().startsWith('/start')) {

            const welcomeText =
                `👋 <b>Welcome to BDTxEarning Bot!</b>\n\n` +
                `🔗 Send me any Blatim link like:\n\n` +
                `<code>https://www.blatim.com/watch/zkxmk2bBF9MIcggE</code>\n\n` +
                `আমি আপনার Blatim লিংকটি BDTxEarning short link-এ convert করে দেব।\n\n` +
                `📝 Text + Link\n` +
                `🖼 Photo + Caption + Link\n` +
                `🎬 Video + Caption + Link\n` +
                `🎞 GIF + Caption + Link\n\n` +
                `সবগুলোই কাজ করবে।`;

            await sendTelegramMessage(
                BOT_TOKEN,
                message.chat.id,
                welcomeText
            );

            return res.status(200).json({
                ok: true
            });
        }

        // ========================================
        // /HELP
        // ========================================

        if (originalText.trim() === '/help') {

            await sendTelegramMessage(
                BOT_TOKEN,
                message.chat.id,
                `ℹ️ <b>How to use</b>\n\n` +
                `আপনি শুধু Blatim link পাঠান।\n\n` +
                `Example:\n` +
                `<code>https://www.blatim.com/watch/zkxmk2bBF9MIcggE</code>\n\n` +
                `অথবা পুরো লেখা সহ পাঠাতে পারেন।\n\n` +
                `ছবি / ভিডিও / GIF-এর caption-এর মধ্যেও Blatim link থাকলে সেটাও convert হবে।`
            );

            return res.status(200).json({
                ok: true
            });
        }

        // ========================================
        // FIND BLATIM LINKS
        // ========================================

        /*
         * IMPORTANT:
         *
         * Only these links are accepted:
         *
         * https://www.blatim.com/watch/xxxxx
         * https://blatim.com/watch/xxxxx
         *
         * Extra query parameters are also allowed.
         */

        const blatimRegex =
            /https?:\/\/(?:www\.)?blatim\.com\/watch\/[A-Za-z0-9_-]+(?:\?[^\s<>"']*)?/gi;

        const matches = originalText.match(blatimRegex);

        if (!matches || matches.length === 0) {

            await sendTelegramMessage(
                BOT_TOKEN,
                message.chat.id,
                `❌ <b>Blatim link পাওয়া যায়নি!</b>\n\n` +
                `শুধু এই ধরনের লিংক পাঠান:\n\n` +
                `<code>https://www.blatim.com/watch/zkxmk2bBF9MIcggE</code>`
            );

            return res.status(200).json({
                ok: true,
                message: 'No Blatim URL found'
            });
        }

        // ========================================
        // TELEGRAM USER
        // ========================================

        const telegramUser = message.from;

        if (!telegramUser || !telegramUser.id) {

            return res.status(200).json({
                ok: true,
                message: 'No Telegram user'
            });
        }

        const telegramId = telegramUser.id;

        // ========================================
        // FIND USER
        // ========================================

        let { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();

        if (userError) {
            console.error('User lookup error:', userError);

            throw userError;
        }

        // ========================================
        // CREATE USER IF NOT EXISTS
        // ========================================

        if (!user) {

            const { data: newUser, error: createUserError } =
                await supabase
                    .from('users')
                    .insert({
                        telegram_id: telegramId,
                        first_name: telegramUser.first_name || null,
                        username: telegramUser.username || null
                    })
                    .select()
                    .single();

            if (createUserError) {
                console.error(
                    'Create user error:',
                    createUserError
                );

                throw createUserError;
            }

            user = newUser;
        }

        // ========================================
        // REMOVE DUPLICATE LINKS
        // ========================================

        const uniqueBlatimLinks = [
            ...new Set(matches)
        ];

        // ========================================
        // CONVERT EACH BLATIM LINK
        // ========================================

        const convertedLinks = [];

        for (const originalLink of uniqueBlatimLinks) {

            // ------------------------------------
            // CHECK EXISTING LINK
            // ------------------------------------

            let { data: existingLink, error: existingError } =
                await supabase
                    .from('links')
                    .select('*')
                    .eq('original_url', originalLink)
                    .eq('user_id', user.id)
                    .maybeSingle();

            if (existingError) {
                console.error(
                    'Existing link lookup error:',
                    existingError
                );

                throw existingError;
            }

            // ------------------------------------
            // CREATE LINK
            // ------------------------------------

            if (!existingLink) {

                const { data: newLink, error: insertError } =
                    await supabase
                        .from('links')
                        .insert({
                            user_id: user.id,
                            original_url: originalLink
                        })
                        .select()
                        .single();

                if (insertError) {
                    console.error(
                        'Link insert error:',
                        insertError
                    );

                    throw insertError;
                }

                existingLink = newLink;
            }

            // ------------------------------------
            // GET SHORT ID
            // ------------------------------------

            const shortId =
                existingLink.short_id;

            if (!shortId) {
                console.error(
                    'short_id missing:',
                    existingLink
                );

                throw new Error(
                    'Short ID was not generated'
                );
            }

            // ------------------------------------
            // CREATE TELEGRAM MINI APP URL
            // ------------------------------------

            const shortLink =
                `https://t.me/BDTxEarningbot/httpsbdtxearningvercelapp?startapp=link_${shortId}`;

            convertedLinks.push({
                original: originalLink,
                short: shortLink
            });
        }

        // ========================================
        // REPLACE ALL BLATIM LINKS
        // ========================================

        let convertedText = originalText;

        for (const item of convertedLinks) {

            convertedText = convertedText.split(
                item.original
            ).join(
                item.short
            );
        }

        // ========================================
        // ESCAPE HTML
        // ========================================

        const safeText =
            escapeHtml(convertedText);

        // ========================================
        // SHARE BUTTON
        // ========================================

        /*
         * Share button uses the first converted link.
         */

        const firstShortLink =
            convertedLinks[0].short;

        // Remove first short link from share text
        const shareText =
            convertedText
                .replace(firstShortLink, '')
                .trim();

        const shareUrl =
            `https://t.me/share/url?url=${encodeURIComponent(firstShortLink)}&text=${encodeURIComponent(shareText)}`;

        // ========================================
        // SEND RESULT
        // ========================================

        await sendTelegramMessage(
            BOT_TOKEN,
            message.chat.id,
            `✅ <b>Link Converted Successfully!</b>\n\n` +
            `${safeText}`,
            {
                inline_keyboard: [
                    [
                        {
                            text: '📤 Share',
                            url: shareUrl
                        }
                    ]
                }
            }
        );

        // ========================================
        // SUCCESS
        // ========================================

        return res.status(200).json({
            ok: true,
            converted: convertedLinks.length
        });

    } catch (error) {

        console.error(
            'BOT ERROR:',
            error
        );

        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}


// ==================================================
// TELEGRAM SEND MESSAGE
// ==================================================

async function sendTelegramMessage(
    botToken,
    chatId,
    text,
    replyMarkup = null
) {

    const url =
        `https://api.telegram.org/bot${botToken}/sendMessage`;

    const body = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const result =
        await response.json();

    if (!result.ok) {

        console.error(
            'Telegram API Error:',
            result
        );

        throw new Error(
            result.description ||
            'Telegram API error'
        );
    }

    return result;
}


// ==================================================
// ESCAPE HTML
// ==================================================

function escapeHtml(text) {

    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
```
