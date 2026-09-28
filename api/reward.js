import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {

    // শুধুমাত্র POST request
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method Not Allowed'
        });
    }

    const { short_id, clicker_tg_id } = req.body;

    // Telegram ID ছাড়া reward দেওয়া হবে না
    if (!short_id) {
        return res.status(400).json({
            error: 'short_id is required'
        });
    }

    if (!clicker_tg_id) {
        return res.status(400).json({
            error: 'Telegram ID is required'
        });
    }

    // Supabase Environment Variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({
            error: 'Vercel ENV variables missing'
        });
    }

    const cleanUrl = supabaseUrl
        .trim()
        .replace(/\/rest\/v1\/?$/, "")
        .replace(/\/$/, "");

    try {

        const supabase = createClient(
            cleanUrl,
            supabaseKey.trim()
        );

        // =====================================================
        // 1. LINK DATA
        // =====================================================

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


        // =====================================================
        // 2. CHECK DAILY DUPLICATE REWARD
        // =====================================================

        const today = new Date()
            .toISOString()
            .split('T')[0];

        const {
            data: existingReward,
            error: existingRewardError
        } = await supabase
            .from('daily_reward_logs')
            .select('id')
            .eq('link_id', linkData.id)
            .eq('clicker_tg_id', String(clicker_tg_id))
            .eq('reward_date', today)
            .maybeSingle();

        if (existingRewardError) {
            console.error(
                'Daily reward check error:',
                existingRewardError
            );

            return res.status(500).json({
                error: 'Could not verify daily reward'
            });
        }

        // একই user + একই link + একই দিন
        if (existingReward) {
            return res.status(200).json({
                success: false,
                already_rewarded: true,
                message: 'You already received reward for this link today.'
            });
        }


        // =====================================================
        // 3. ADMIN SETTINGS / CPM
        // =====================================================

        const {
            data: adminSettings
        } = await supabase
            .from('settings')
            .select('*')
            .limit(1)
            .single();

        const cpm =
            adminSettings && adminSettings.cpm
                ? adminSettings.cpm
                : 2.0;

        const earn_amount = cpm / 1000;


        // =====================================================
        // 4. CREATE DAILY REWARD LOG
        // =====================================================

        /*
         * এই unique constraint নিশ্চিত করবে:
         *
         * একই link
         * +
         * একই Telegram ID
         * +
         * একই দিন
         *
         * = মাত্র ১টি reward
         */

        const {
            data: rewardLog,
            error: rewardLogError
        } = await supabase
            .from('daily_reward_logs')
            .insert([{
                link_id: linkData.id,
                clicker_tg_id: String(clicker_tg_id),
                reward_date: today
            }])
            .select()
            .single();

        if (rewardLogError) {

            // Duplicate হলে reward দেওয়া হবে না
            if (
                rewardLogError.code === '23505' ||
                rewardLogError.message?.includes('daily_reward_logs_unique')
            ) {
                return res.status(200).json({
                    success: false,
                    already_rewarded: true,
                    message: 'You already received reward for this link today.'
                });
            }

            console.error(
                'Reward log insert error:',
                rewardLogError
            );

            return res.status(500).json({
                error: 'Could not create reward record'
            });
        }


        // =====================================================
        // 5. CLICK LOG
        // =====================================================

        const {
            error: clickLogError
        } = await supabase
            .from('click_logs')
            .insert([{
                link_id: linkData.id,
                clicker_tg_id: String(clicker_tg_id)
            }]);

        if (clickLogError) {
            console.error(
                'Click log error:',
                clickLogError
            );
        }


        // =====================================================
        // 6. UPDATE LINK CLICKS + EARNINGS
        // =====================================================

        const {
            error: linkUpdateError
        } = await supabase
            .from('links')
            .update({
                clicks: (linkData.clicks || 0) + 1,
                earnings:
                    (linkData.earnings || 0) + earn_amount
            })
            .eq('id', linkData.id);

        if (linkUpdateError) {
            console.error(
                'Link update error:',
                linkUpdateError
            );
        }


        // =====================================================
        // 7. LINK OWNER USER DATA
        // =====================================================

        const {
            data: userData
        } = await supabase
            .from('users')
            .select('*')
            .eq('id', linkData.user_id)
            .single();


        if (userData) {

            // =================================================
            // 8. UPDATE USER EARNINGS
            // =================================================

            const {
                error: userUpdateError
            } = await supabase
                .from('users')
                .update({

                    balance:
                        (userData.balance || 0)
                        + earn_amount,

                    today_earnings:
                        (userData.today_earnings || 0)
                        + earn_amount,

                    total_earnings:
                        (userData.total_earnings || 0)
                        + earn_amount,

                    total_clicks:
                        (userData.total_clicks || 0)
                        + 1,

                    today_clicks:
                        (userData.today_clicks || 0)
                        + 1

                })
                .eq('id', userData.id);

            if (userUpdateError) {
                console.error(
                    'User update error:',
                    userUpdateError
                );
            }


            // =================================================
            // 9. REFERRAL COMMISSION
            // =================================================

            const referPercent =
                adminSettings &&
                adminSettings.refer_percent
                    ? adminSettings.refer_percent
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
                    .single();


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
                        .single();


                    if (referrerData) {

                        const referComm =
                            earn_amount *
                            (referPercent / 100);


                        await supabase
                            .from('users')
                            .update({

                                balance:
                                    (referrerData.balance || 0)
                                    + referComm,

                                total_earnings:
                                    (referrerData.total_earnings || 0)
                                    + referComm

                            })
                            .eq(
                                'id',
                                referrerData.id
                            );
                    }
                }
            }
        }


        // =====================================================
        // 10. SUCCESS
        // =====================================================

        return res.status(200).json({

            success: true,

            already_rewarded: false,

            reward_amount: earn_amount,

            message:
                'Reward, Views & Commission added successfully.'

        });


    } catch (error) {

        console.error(
            'Reward API Error:',
            error
        );

        return res.status(500).json({
            error: error.message
        });
    }
}
