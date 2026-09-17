import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // শুধুমাত্র POST রিকোয়েস্ট গ্রহণ করবে
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { short_id, clicker_tg_id } = req.body;

    // Vercel Environment Variables থেকে ডাটাবেস এর ডিটেইলস নেওয়া হচ্ছে
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
         return res.status(500).json({ error: 'Vercel ENV variables missing' });
    }

    // URL Cleanup (URL-এর শেষে বাড়তি স্লাশ থাকলে তা সরানোর জন্য)
    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

    try {
        const supabase = createClient(cleanUrl, supabaseKey.trim());

        // ১. লিঙ্ক এর ডাটা বের করা
        const { data: linkData, error: linkErr } = await supabase.from('links').select('*').eq('short_id', short_id).single();
        if (linkErr || !linkData) return res.status(404).json({ error: 'Link not found' });

        // ২. অ্যাডমিন সেটিংস থেকে লাইভ CPM রেট নেওয়া
        const { data: adminSettings } = await supabase.from('settings').select('*').limit(1).single();
        const cpm = adminSettings && adminSettings.cpm ? adminSettings.cpm : 2.0; 
        const earn_amount = cpm / 1000; // ১০০০ ভিউ এর জন্য CPM অনুযায়ী আর্নিং ক্যালকুলেশন

        // ৩. ডুপ্লিকেট ক্লিক এবং ভিউ ট্র্যাক করার জন্য click_logs টেবিলে রেকর্ড সেভ করা
        if (clicker_tg_id) {
            await supabase.from('click_logs').insert([{ 
                link_id: linkData.id, 
                clicker_tg_id: clicker_tg_id 
            }]);
        }

        // ৪. Links টেবিলে ক্লিক এবং আর্নিং আপডেট করা
        await supabase.from('links').update({
            clicks: (linkData.clicks || 0) + 1,
            earnings: (linkData.earnings || 0) + earn_amount
        }).eq('id', linkData.id);

        // ৫. User টেবিলে মেইন ব্যালেন্স এবং টুডে ভিউ আপডেট করা
        const { data: userData } = await supabase.from('users').select('*').eq('id', linkData.user_id).single();
        
        if (userData) {
            await supabase.from('users').update({
                balance: (userData.balance || 0) + earn_amount,
                today_earnings: (userData.today_earnings || 0) + earn_amount,
                total_earnings: (userData.total_earnings || 0) + earn_amount,
                total_clicks: (userData.total_clicks || 0) + 1,
                today_clicks: (userData.today_clicks || 0) + 1
            }).eq('id', userData.id);

            // ৬. রেফারেল কমিশন লজিক (অ্যাডমিনের সেট করা পার্সেন্টেজ অনুযায়ী)
            const referPercent = adminSettings && adminSettings.refer_percent ? adminSettings.refer_percent : 10;
            if (referPercent > 0) {
                const { data: referralData } = await supabase.from('referrals').select('referrer_tg_id').eq('referred_tg_id', userData.telegram_id).single();
                
                if (referralData && referralData.referrer_tg_id) {
                    const { data: referrerData } = await supabase.from('users').select('*').eq('telegram_id', referralData.referrer_tg_id).single();
                    if (referrerData) {
                        const referComm = earn_amount * (referPercent / 100);
                        await supabase.from('users').update({
                            balance: (referrerData.balance || 0) + referComm,
                            total_earnings: (referrerData.total_earnings || 0) + referComm
                        }).eq('id', referrerData.id);
                    }
                }
            }
        }

        return res.status(200).json({ success: true, message: 'Reward, Views & Commission added perfectly' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
