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
        // GET MESSAGE TEXT
        // ========================================

        const text = (message.text || '').trim();

        if (!text) {
            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>কোনো Text বা Link পাওয়া যায়নি।</b>\n\nএকটি লেখা বা URL পাঠান।`
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
                `📝 আপনি পুরো লেখা সহ Link পাঠাতে পারেন।\n\n` +
                `উদাহরণ:\n\n` +
                `<code>🔥 নতুন মুভি এসেছে!\n\nমুভি দেখতে:\nhttps://example.com/movie\n\n❤️ সবাই শেয়ার করুন</code>\n\n` +
                `আমি শুধু Link-টি Short করে পুরো লেখা আপনাকে আবার দিয়ে দেব।`
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
                `শুধু Link অথবা পুরো লেখা সহ Link পাঠান।\n\n` +
                `উদাহরণ:\n\n` +
                `<code>আজকের নতুন মুভি দেখুন:\nhttps://example.com/movie\n\nশেয়ার করতে ভুলবেন না ❤️</code>\n\n` +
                `Bot পুরো লেখাটি রেখে শুধু Link পরিবর্তন করে দেবে।`
            );

            return res.status(200).json({
                success: true
            });
        }

        // ========================================
        // FIND ALL URLS IN TEXT
        // ========================================

        const urls = extractUrls(text);

        if (urls.length === 0) {

            await sendMessage(
                BOT_TOKEN,
                chatId,
                `❌ <b>কোনো Valid Link পাওয়া যায়নি।</b>\n\n` +
                `আপনার লেখার মধ্যে <b>http://</b> অথবা <b>https://</b> দিয়ে শুরু হওয়া Link থাকতে হবে।\n\n` +
                `উদাহরণ:\n<code>https://example.com</code>`
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
                    `⚠️ আপনার account তৈরি করা যাচ্ছে না।\n\nকিছুক্ষণ পরে আবার চেষ্টা করুন।`
                );

                return res.status(200).json({
                    success: false
                });
            }

            userData = newUser;
        }

        // ========================================
        // CONVERT EVERY URL
        // ========================================

        let convertedText = text;

        for (const originalUrl of urls) {

            const shortId = await generateUniqueShortId(
                supabase
            );

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

            const BOT_USERNAME = 'BDTxEarningbot';
            const APP_SHORT_NAME = 'httpsbdtxearningvercelapp';

            const shortLink =
                `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${linkData.short_id}`;

            // ====================================
            // REPLACE ONLY ORIGINAL URL
            // ====================================

            convertedText = convertedText.split(
                originalUrl
            ).join(
                shortLink
            );
        }

        // ========================================
        // SEND FINAL CONVERTED TEXT
        // ========================================

        await sendMessage(
            BOT_TOKEN,
            chatId,
            `✅ <b>Link Converted Successfully!</b>\n\n` +
            convertedText
        );

        return res.status(200).json({
            success: true,
            converted_urls: urls.length
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
// EXTRACT URLS
// ============================================

function extractUrls(text) {

    const urlRegex =
        /https?:\/\/[^\s<>"']+/gi;

    const matches =
        text.match(urlRegex) || [];

    // Remove duplicate URLs
    return [...new Set(
        matches.map(url =>
            cleanUrl(url)
        )
    )];
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

    for (let attempt = 0; attempt < 10; attempt++) {

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
    text
) {

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
