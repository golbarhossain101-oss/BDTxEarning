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

    // ========================================
    // ENVIRONMENT VARIABLES
    // ========================================

    const BOT_TOKEN = process.env.BOT_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({
            error: 'Required Vercel environment variables are missing.'
        });
    }

    try {

        const supabase = createClient(
            SUPABASE_URL.trim().replace(/\/$/, ''),
            SUPABASE_SERVICE_KEY.trim()
        );

        const update = req.body;

        // ========================================
        // GET TELEGRAM MESSAGE
        // ========================================

        const message = update?.message;

        if (!message) {
            return res.status(200).json({
                success: true,
                message: 'No message to process'
            });
        }

        const chatId = message.chat?.id;
        const telegramUser = message.from;

        if (!chatId || !telegramUser) {
            return res.status(200).json({
                success: true
            });
        }

        // ========================================
        // GET TEXT OR CAPTION
        // ========================================

        /*
         * Text message:
         * message.text
         *
         * Photo/Video/GIF + Caption:
         * message.caption
         *
         * Media itself will NEVER be sent back.
         * Only text/caption will be processed.
         */

        const rawText =
            message.text ||
            message.caption ||
            '';

        const text = rawText.trim();

        // ========================================
        // NO TEXT / CAPTION
        // ========================================

        if (!text) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>কোনো Text বা Blatim Link পাওয়া যায়নি।</b>\n\n` +
                `শুধু <b>Blatim.com</b> এর Link পাঠান।\n\n` +
                `📷 ছবি / 🎥 ভিডিও / 🎞️ GIF পাঠালে Caption-এর মধ্যে Blatim Link থাকতে হবে।`
            );

            return res.status(200).json({
                success: true
            });
        }

        // ========================================
        // /START
        // ========================================

        if (text === '/start') {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `👋 <b>BDTxEarning Link Converter</b>\n\n` +
                `📝 আপনি পুরো লেখা সহ Blatim Link পাঠাতে পারেন।\n\n` +
                `📷 ছবি + Caption + Link\n` +
                `🎥 ভিডিও + Caption + Link\n` +
                `🎞️ GIF + Caption + Link\n\n` +
                `মিডিয়া বাদ দিয়ে শুধু Caption-এর লেখা ও Blatim Link convert করা হবে।\n\n` +
                `⚠️ শুধুমাত্র <b>blatim.com</b> এর Link convert হবে।\n` +
                `অন্য কোনো Website-এর Link convert হবে না।`
            );

            return res.status(200).json({
                success: true
            });
        }

        // ========================================
        // /HELP
        // ========================================

        if (text === '/help') {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `📖 <b>How to use</b>\n\n` +
                `শুধু <b>Blatim.com</b> এর Link অথবা পুরো লেখা সহ Blatim Link পাঠান।\n\n` +
                `📷 ছবি + Caption থাকলে ছবি বাদ যাবে।\n` +
                `🎥 ভিডিও + Caption থাকলে ভিডিও বাদ যাবে।\n` +
                `🎞️ GIF + Caption থাকলে GIF বাদ যাবে।\n\n` +
                `⚠️ অন্য Website-এর Link convert হবে না।\n\n` +
                `Bot পুরো লেখাটি রেখে শুধু Blatim Link পরিবর্তন করে দেবে।`
            );

            return res.status(200).json({
                success: true
            });
        }

        // ========================================
        // FIND ONLY BLATIM URLS
        // ========================================

        const urls = extractBlatimUrls(text);

        // ========================================
        // NO BLATIM LINK
        // ========================================

        if (urls.length === 0) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>কোনো Blatim Link পাওয়া যায়নি।</b>\n\n` +
                `এই Bot শুধুমাত্র <b>blatim.com</b> এর Link convert করে।\n\n` +
                `উদাহরণ:\n` +
                `<code>https://www.blatim.com/xxxxx</code>`
            );

            return res.status(200).json({
                success: true
            });
        }

        // ========================================
        // FIND / CREATE USER
        // ========================================

        const telegramId = Number(telegramUser.id);

        let {
            data: userData,
            error: userError
        } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();

        if (userError) {

            console.error(
                'User lookup error:',
                userError
            );

            return res.status(500).json({
                error: 'Could not find user'
            });
        }

        // ========================================
        // CREATE USER IF NOT EXISTS
        // ========================================

        if (!userData) {

            const {
                data: newUser,
                error: createUserError
            } = await supabase
                .from('users')
                .insert([{
                    telegram_id: telegramId,
                    first_name: telegramUser.first_name || null,
                    last_name: telegramUser.last_name || null,
                    username: telegramUser.username || null,
                    balance: 0,
                    total_earnings: 0,
                    today_earnings: 0,
                    total_clicks: 0,
                    today_clicks: 0,
                    is_blocked: false
                }])
                .select()
                .single();

            if (createUserError) {

                console.error(
                    'Create user error:',
                    createUserError
                );

                await sendMessage(
                    BOT_TOKEN,
                    chatId,
                    `⚠️ আপনার account তৈরি করা যাচ্ছে না।\n\n` +
                    `কিছুক্ষণ পরে আবার চেষ্টা করুন।`
                );

                return res.status(200).json({
                    success: false
                });
            }

            userData = newUser;
        }

        // ========================================
        // CONVERT ONLY BLATIM URLS
        // ========================================

        let convertedText = text;

        const convertedLinks = [];

        for (const originalUrl of urls) {

            const shortId =
                await generateUniqueShortId(supabase);

            if (!shortId) {

                console.error(
                    'Could not generate unique short ID'
                );

                continue;
            }

            // ====================================
            // INSERT LINK
            // ====================================

            const {
                data: linkData,
                error: linkError
            } = await supabase
                .from('links')
                .insert([{
                    original_url: originalUrl,
                    short_id: shortId,
                    user_id: userData.id,
                    clicks: 0,
                    earnings: 0
                }])
                .select()
                .single();

            if (linkError) {

                console.error(
                    'Link insert error:',
                    linkError
                );

                continue;
            }

            // ====================================
            // MINI APP SHORT LINK
            // ====================================

            const BOT_USERNAME =
                'BDTxEarningbot';

            const APP_SHORT_NAME =
                'httpsbdtxearningvercelapp';

            const shortLink =
                `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${linkData.short_id}`;

            // ====================================
            // SAVE CONVERTED LINK
            // ====================================

            convertedLinks.push({
                original: originalUrl,
                short: shortLink
            });

            // ====================================
            // REPLACE ORIGINAL BLATIM URL
            // ====================================

            convertedText =
                convertedText
                    .split(originalUrl)
                    .join(shortLink);
        }

        // ========================================
        // CHECK CONVERSION
        // ========================================

        if (convertedLinks.length === 0) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>Blatim Link Convert করা যায়নি।</b>\n\n` +
                `কিছুক্ষণ পরে আবার চেষ্টা করুন।`
            );

            return res.status(200).json({
                success: false
            });
        }

        // ========================================
        // CREATE SHARE BUTTON
        // ========================================

        const firstShortLink =
            convertedLinks[0].short;

        const shareText =
            convertedText
                .replace(firstShortLink, '')
                .trim();

        const shareUrl =
            `https://t.me/share/url?url=${encodeURIComponent(firstShortLink)}` +
            `&text=${encodeURIComponent(shareText)}`;

        // ========================================
        // SEND FINAL CONVERTED TEXT
        // ========================================

        await sendMessage(
            BOT_TOKEN,
            chatId,
            `✅ <b>Blatim Link Converted Successfully!</b>\n\n` +
            convertedText,
            {
                inline_keyboard: [
                    [
                        {
                            text: '📤 Share',
                            url: shareUrl
                        }
                    ]
                ]
            }
        );

        return res.status(200).json({
            success: true,
            converted_urls: convertedLinks.length
        });

    } catch (error) {

        console.error(
            'BOT API ERROR:',
            error
        );

        return res.status(500).json({
            error: 'Bot API failed',
            message: error.message || null
        });
    }
}


// ============================================
// EXTRACT ONLY BLATIM URLS
// ============================================

function extractBlatimUrls(text) {

    const urlRegex =
        /https?:\/\/[^\s<>"']+/gi;

    const matches =
        text.match(urlRegex) || [];

    const blatimUrls = [];

    for (const url of matches) {

        const cleanedUrl =
            cleanUrl(url);

        try {

            const parsedUrl =
                new URL(cleanedUrl);

            const hostname =
                parsedUrl.hostname
                    .toLowerCase()
                    .replace(/^www\./, '');

            // ====================================
            // ONLY BLATIM.COM
            // ====================================

            if (hostname === 'blatim.com') {

                blatimUrls.push(cleanedUrl);
            }

        } catch (error) {

            // Ignore invalid URLs

        }
    }

    // Remove duplicate URLs

    return [...new Set(blatimUrls)];
}


// ============================================
// CLEAN URL
// ============================================

function cleanUrl(url) {

    return url
        .replace(/[.,!?;:)\]}]+$/g, '');
}


// ============================================
// GENERATE UNIQUE SHORT ID
// ============================================

async function generateUniqueShortId(
    supabase
) {

    for (
        let attempt = 0;
        attempt < 10;
        attempt++
    ) {

        const shortId =
            Math.random()
                .toString(36)
                .substring(2, 9);

        const {
            data: existingLink,
            error
        } = await supabase
            .from('links')
            .select('id')
            .eq('short_id', shortId)
            .maybeSingle();

        if (error) {

            console.error(
                'Short ID check error:',
                error
            );

            continue;
        }

        if (!existingLink) {
            return shortId;
        }
    }

    return null;
}


// ============================================
// SEND TELEGRAM MESSAGE
// ============================================

async function sendMessage(
    BOT_TOKEN,
    chatId,
    text,
    replyMarkup = null
) {

    const body = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };

    // ========================================
    // INLINE KEYBOARD
    // ========================================

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    const response =
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify(body)
            }
        );

    const data =
        await response.json();

    if (!data.ok) {

        console.error(
            'Telegram sendMessage error:',
            data.description
        );
    }

    return data;
}
```
