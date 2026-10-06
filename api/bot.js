import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // Telegram webhook শুধু POST গ্রহণ করবে
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method Not Allowed'
        });
    }

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

        // Telegram message আছে কিনা
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

        const text = (message.text || '').trim();

        // =========================
        // /start
        // =========================
        if (text === '/start') {
            await sendMessage(
                BOT_TOKEN,
                chatId,
                `👋 <b>BDTxEarning Link Converter</b>\n\n🔗 আমাকে যেকোনো <b>HTTP/HTTPS link</b> পাঠান।\n\nআমি সেটিকে আপনার BDTxEarning Short Link-এ convert করে দেব।`
            );

            return res.status(200).json({
                success: true
            });
        }

        // =========================
        // /help
        // =========================
        if (text === '/help') {
            await sendMessage(
                BOT_TOKEN,
                chatId,
                `📖 <b>How to use</b>\n\nশুধু একটি link পাঠান।\n\nউদাহরণ:\n<code>https://example.com/your-long-link</code>\n\nআমি আপনাকে একটি short link দিয়ে দেব।`
            );

            return res.status(200).json({
                success: true
            });
        }

        // =========================
        // URL validation
        // =========================
        if (!isValidUrl(text)) {
            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>সঠিক Link দিন</b>\n\nশুধু <b>http://</b> অথবা <b>https://</b> দিয়ে শুরু হওয়া link পাঠান।\n\nউদাহরণ:\n<code>https://example.com</code>`
            );

            return res.status(200).json({
                success: true
            });
        }

        // =========================
        // FIND / CREATE USER
        // =========================

        const telegramId = Number(telegramUser.id);

        let { data: userData, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();

        if (userError) {
            console.error('User lookup error:', userError);

            return res.status(500).json({
                error: 'Could not find user'
            });
        }

        // User না থাকলে তৈরি করবে
        if (!userData) {
            const { data: newUser, error: createUserError } = await supabase
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
                console.error('Create user error:', createUserError);

                await sendMessage(
                    BOT_TOKEN,
                    chatId,
                    `⚠️ আপনার account তৈরি করা যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন।`
                );

                return res.status(200).json({
                    success: false
                });
            }

            userData = newUser;
        }

        // =========================
        // GENERATE UNIQUE SHORT ID
        // =========================

        let shortId;
        let isUnique = false;

        for (let attempt = 0; attempt < 10; attempt++) {

            shortId = Math.random()
                .toString(36)
                .substring(2, 9);

            const { data: existingLink } = await supabase
                .from('links')
                .select('id')
                .eq('short_id', shortId)
                .maybeSingle();

            if (!existingLink) {
                isUnique = true;
                break;
            }
        }

        if (!isUnique) {
            await sendMessage(
                BOT_TOKEN,
                chatId,
                `⚠️ Short link তৈরি করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।`
            );

            return res.status(200).json({
                success: false
            });
        }

        // =========================
        // INSERT LINK
        // =========================

        const { data: linkData, error: linkError } = await supabase
            .from('links')
            .insert([{
                original_url: text,
                short_id: shortId,
                user_id: userData.id,
                clicks: 0,
                earnings: 0
            }])
            .select()
            .single();

        if (linkError) {
            console.error('Link insert error:', linkError);

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ Link convert করা যায়নি। একটু পরে আবার চেষ্টা করুন।`
            );

            return res.status(200).json({
                success: false
            });
        }

        // =========================
        // YOUR MINI APP SHORT LINK
        // =========================

        const BOT_USERNAME = 'BDTxEarningbot';
        const APP_SHORT_NAME = 'httpsbdtxearningvercelapp';

        const shortLink =
            `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${linkData.short_id}`;

        // =========================
        // SEND RESULT
        // =========================

        const resultMessage =
            `✅ <b>Link Converted Successfully!</b>\n\n` +
            `🔗 <b>Your Short Link:</b>\n` +
            `<code>${shortLink}</code>\n\n` +
            `📊 আপনার link থেকে click ও earning আপনার account-এ যোগ হবে।`;

        await sendMessage(
            BOT_TOKEN,
            chatId,
            resultMessage
        );

        return res.status(200).json({
            success: true,
            short_id: linkData.short_id,
            short_link: shortLink
        });

    } catch (error) {

        console.error('BOT API ERROR:', error);

        return res.status(500).json({
            error: 'Bot API failed',
            message: error.message || null
        });
    }
}


// ========================================
// SEND TELEGRAM MESSAGE
// ========================================

async function sendMessage(BOT_TOKEN, chatId, text) {

    const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        }
    );

    const data = await response.json();

    if (!data.ok) {
        console.error(
            'Telegram sendMessage error:',
            data.description
        );
    }

    return data;
}


// ========================================
// URL VALIDATION
// ========================================

function isValidUrl(value) {

    try {

        const url = new URL(value);

        return (
            url.protocol === 'http:' ||
            url.protocol === 'https:'
        );

    } catch (error) {

        return false;
    }
}
