import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {

    // শুধুমাত্র POST
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method Not Allowed'
        });
    }

    const { short_id, clicker_tg_id } = req.body || {};

    // Basic validation
    if (!short_id || !clicker_tg_id) {
        return res.status(400).json({
            error: 'short_id and clicker_tg_id are required'
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({
            error: 'Vercel ENV variables missing'
        });
    }

    const cleanUrl = supabaseUrl
        .trim()
        .replace(/\/rest\/v1\/?$/, '')
        .replace(/\/$/, '');

    try {

        const supabase = createClient(
            cleanUrl,
            supabaseKey.trim()
        );

        // ==========================================
        // 1. Link খুঁজে বের করা
        // ==========================================

        const {
            data: linkData,
            error: linkErr
        } = await supabase
            .from('links')
            .select('*')
            .eq('short_id', short_id)
            .single();

        if (linkErr || !linkData) {
            return res.status(404).json({
                error: 'Link not found'
            });
        }


        // ==========================================
        // 2. নিজের link কিনা check
        // ==========================================

        const {
            data: ownerData
        } = await supabase
            .from('users')
            .select('telegram_id')
            .eq('id', linkData.user_id)
            .single();

        if (
            ownerData &&
            String(ownerData.telegram_id) === String(clicker_tg_id)
        ) {
            return res.status(403).json({
                success: false,
                error: 'Self click is not allowed'
            });
        }


        // ==========================================
        // 3. Duplicate click check
        // ==========================================

        const {
            data: existingClick,
            error: duplicateError
        } = await supabase
            .from('click_logs')
            .select('id')
            .eq('link_id', linkData.id)
            .eq('clicker_tg_id', clicker_tg_id)
            .limit(1)
            .maybeSingle();

        if (duplicateError) {
            return res.status(500).json({
                error: duplicateError.message
            });
        }

        if (existingClick) {
            return res.status(409).json({
                success: false,
                error: 'You already viewed this link'
            });
        }


        // ==========================================
        // 4. Admin settings
        // ==========================================

        const {
            data: adminSettings
        } = await supabase
            .from('settings')
            .select('*')
            .limit(1)
            .single();

        const cpm =
            adminSettings && adminSettings.cpm
                ? Number(adminSettings.cpm)
                : 2.0;

        const earn_amount = cpm / 1000;


        // ==========================================
        // 5. Click log তৈরি
        // ==========================================

        const {
            error: clickLogError
        } = await supabase
            .from('click_logs')
            .insert([{
                link_id: linkData.id,
                clicker_tg_id: clicker_tg_id
            }]);

        if (clickLogError) {
            return res.status(500).json({
                error: clickLogError.message
            });
        }


        // ==========================================
        // 6. Link clicks + earnings update
        // ==========================================

        const {
            error: linkUpdateError
        } = await supabase
            .from('links')
            .update({
                clicks: (linkData.clicks || 0) + 1,
                earnings: (linkData.earnings || 0) + earn_amount
            })
            .eq('id', linkData.id);

        if (linkUpdateError) {
            return res.status(500).json({
                error: linkUpdateError.message
            });
        }


        // ==========================================
        // 7. Link owner-এর earnings update
        // ==========================================

        const {
            data: userData,
            error: userError
        } = await supabase
            .from('users')
            .select('*')
            .eq('id', linkData.user_id)
            .single();

        if (userError) {
            return res.status(500).json({
                error: userError.message
            });
        }


        if (userData) {

            const {
                error: userUpdateError
            } = await supabase
                .from('users')
                .update({
                    balance: (userData.balance || 0) + earn_amount,
                    today_earnings:
                        (userData.today_earnings || 0) + earn_amount,
                    total_earnings:
                        (userData.total_earnings || 0) + earn_amount,
                    total_clicks:
                        (userData.total_clicks || 0) + 1,
                    today_clicks:
                        (userData.today_clicks || 0) + 1
                })
                .eq('id', userData.id);

            if (userUpdateError) {
                return res.status(500).json({
                    error: userUpdateError.message
                });
            }


            // ======================================
            // 8. Referral commission
            // ======================================

            const referPercent =
                adminSettings &&
                adminSettings.refer_percent
                    ? Number(adminSettings.refer_percent)
                    : 10;

            if (referPercent > 0) {

                const {
                    data: referralData
                } = await supabase
                    .from('referrals')
                    .select('referrer_tg_id')
                    .eq(
                        'referred_tg_id',
                        userData.telegram_id
                    )
                    .maybeSingle();

                if (
                    referralData &&
                    referralData.referrer_tg_id
                ) {

                    const {
                        data: referrerData
                    } = await supabase
                        .from('users')
                        .select('*')
                        .eq(
                            'telegram_id',
                            referralData.referrer_tg_id
                        )
                        .maybeSingle();

                    if (referrerData) {

                        const referComm =
                            earn_amount *
                            (referPercent / 100);

                        await supabase
                            .from('users')
                            .update({
                                balance:
                                    (referrerData.balance || 0) +
                                    referComm,

                                total_earnings:
                                    (referrerData.total_earnings || 0) +
                                    referComm
                            })
                            .eq(
                                'id',
                                referrerData.id
                            );
                    }
                }
            }
        }


        // ==========================================
        // SUCCESS
        // ==========================================

        return res.status(200).json({
            success: true,
            message: 'Reward, views & commission added successfully',
            earned: earn_amount
        });

    } catch (error) {

        console.error('Reward API Error:', error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
