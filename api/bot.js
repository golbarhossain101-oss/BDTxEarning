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
    // ENV
    // ========================================

    const BOT_TOKEN = process.env.BOT_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({
            error: 'Missing environment variables'
        });
    }

    try {

        const supabase = createClient(
            SUPABASE_URL.trim().replace(/\/$/, ''),
            SUPABASE_SERVICE_KEY.trim()
        );

        const update = req.body || {};

        // ========================================
        // TELEGRAM MESSAGE
        // ========================================

        const message = update.message;

        if (!message) {
            return res.status(200).json({
                ok: true,
                message: 'No message'
            });
        }

        const chatId = message.chat?.id;
        const telegramUser = message.from;

        if (!chatId || !telegramUser) {
            return res.status(200).json({
                ok: true
            });
        }

        // ========================================
        // TEXT / CAPTION
        // ========================================

        // Text message
        // Photo + caption
        // Video + caption
        // GIF + caption
        // Document + caption

        let rawText = '';

        if (typeof message.text === 'string') {
            rawText = message.text;
        } else if (typeof message.caption === 'string') {
            rawText = message.caption;
        }

        const text = rawText.trim();

        // ========================================
        // /START
        // ========================================

        if (text === '/start') {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `👋 <b>BDTxEarning Link Converter</b>\n\n` +
                `আপনি Blatim.com এর Link পাঠান।\n\n` +
                `Bot পুরো লেখাটি রেখে শুধু Blatim Link পরিবর্তন করে দেবে।\n\n` +
                `📷 ছবি + Caption + Link\n` +
                `🎥 ভিডিও + Caption + Link\n` +
                `🎞️ GIF + Caption + Link\n\n` +
                `মিডিয়া নিজে থেকে ফেরত পাঠানো হবে না।\n` +
                `Caption-এর লেখা ও Link রাখা হবে।`
            );

            return res.status(200).json({
                ok: true
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
                `যেকোনো Blatim Link পাঠান।\n\n` +
                `উদাহরণ:\n` +
                `<code>https://www.blatim.com/watch/zkxmk2bBF9MIcggE</code>\n\n` +
                `পুরো লেখা সহ Link পাঠালেও কাজ করবে।\n\n` +
                `📷 Photo Caption\n` +
                `🎥 Video Caption\n` +
                `🎞️ GIF Caption\n\n` +
                `শুধু Blatim Link পরিবর্তন হবে।`
            );

            return res.status(200).json({
                ok: true
            });
        }

        // ========================================
        // NO TEXT / CAPTION
        // ========================================

        if (!text) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>কোনো Text বা Caption পাওয়া যায়নি।</b>\n\n` +
                `Blatim Link সহ Text/Caption পাঠান।`
            );

            return res.status(200).json({
                ok: true
            });
        }

        // ========================================
        // FIND BLATIM LINKS
        // ========================================

        const urls = extractBlatimUrls(text);

        if (urls.length === 0) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>Blatim Link পাওয়া যায়নি।</b>\n\n` +
                `উদাহরণ:\n` +
                `<code>https://www.blatim.com/watch/zkxmk2bBF9MIcggE</code>`
            );

            return res.status(200).json({
                ok: true
            });
        }

        // ========================================
        // FIND USER
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

            console.error('User lookup error:', userError);

            return res.status(200).json({
                ok: false,
                error: 'User lookup failed'
            });
        }

        // ========================================
        // CREATE USER
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
                    `⚠️ Account তৈরি করা যাচ্ছে না।\n\nকিছুক্ষণ পরে আবার চেষ্টা করুন।`
                );

                return res.status(200).json({
                    ok: false
                });
            }

            userData = newUser;
        }

        // ========================================
        // CONVERT LINKS
        // ========================================

        let convertedText = text;
        const convertedLinks = [];

        for (const originalUrl of urls) {

            const shortId =
                await generateUniqueShortId(supabase);

            if (!shortId) {
                continue;
            }

            // ====================================
            // INSERT INTO LINKS
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
            // MINI APP LINK
            // ====================================

            const BOT_USERNAME = 'BDTxEarningbot';
            const APP_SHORT_NAME = 'httpsbdtxearningvercelapp';

            const shortLink =
                `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${linkData.short_id}`;

            convertedLinks.push({
                original: originalUrl,
                short: shortLink
            });

            // ====================================
            // REPLACE ORIGINAL LINK
            // ====================================

            convertedText =
                convertedText.split(originalUrl).join(shortLink);
        }

        // ========================================
        // CONVERSION FAILED
        // ========================================

        if (convertedLinks.length === 0) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>Link Convert করা যায়নি।</b>\n\nআবার চেষ্টা করুন।`
            );

            return res.status(200).json({
                ok: false
            });
        }

        // ========================================
        // SHARE BUTTON
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
        // FINAL MESSAGE
        // ========================================

        await sendMessage(
            BOT_TOKEN,
            chatId,

            `✅ <b>Link Converted Successfully!</b>\n\n` +
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
            ok: true,
            converted_urls: convertedLinks.length
        });

    } catch (error) {

        console.error('BOT ERROR:', error);

        return res.status(200).json({
            ok: false,
            error: error.message
        });
    }
}


// ============================================
// EXTRACT BLATIM URL
// ============================================

function extractBlatimUrls(text) {

    /*
     * Supports:
     *
     * https://blatim.com/watch/xxxxx
     * https://www.blatim.com/watch/xxxxx
     * http://blatim.com/watch/xxxxx
     * http://www.blatim.com/watch/xxxxx
     *
     * Also supports other Blatim paths.
     */

    const urlRegex =
        /https?:\/\/(?:www\.)?blatim\.com\/[^\s<>"']+/gi;

    const matches =
        text.match(urlRegex) || [];

    const result = [];

    for (const url of matches) {

        const cleaned = cleanUrl(url);

        try {

            const parsed = new URL(cleaned);

            const hostname =
                parsed.hostname
                    .toLowerCase()
                    .replace(/^www\./, '');

            if (hostname === 'blatim.com') {

                result.push(cleaned);
            }

        } catch (e) {

            // Ignore invalid URL
        }
    }

    return [...new Set(result)];
}


// ============================================
// CLEAN URL
// ============================================

function cleanUrl(url) {

    return url
        .replace(/[.,!?;:)\]}]+$/g, '');
}


// ============================================
// UNIQUE SHORT ID
// ============================================

async function generateUniqueShortId(supabase) {

    for (let attempt = 0; attempt < 20; attempt++) {

        const shortId =
            Math.random()
                .toString(36)
                .substring(2, 9);

        const {
            data,
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

        if (!data) {
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
            'Telegram error:',
            data.description
        );
    }

    return data;
}
