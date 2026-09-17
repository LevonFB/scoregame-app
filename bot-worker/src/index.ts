/// <reference types="@cloudflare/workers-types" />
// ============================================================
// ScoreGame Bot Worker
// Telegram webhook + Cron reminders + Daily summaries
// ============================================================
import { resolveBotFlags, type BotFeatureFlags } from "./featureFlags";
import { logEvent, makeRunId } from "./obs";

export interface Env {
    DB: D1Database;
    BOT_TOKEN: string;
    WEBHOOK_SECRET: string;
    INTERNAL_API_SECRET?: string;
    MINIAPP_URL: string;
    BOT_USERNAME?: string;
    ADMIN_IDS: string;
    USER_NOTIFICATIONS_ENABLED?: string;
    // Stage 1 safe-optimization feature flags (see featureFlags.ts).
    // Optional; absence preserves current production behavior.
    MAINTENANCE_POLL_THROTTLE_ENABLED?: string;
    MAINTENANCE_POLL_INTERVAL_MINUTES?: string;
}
function isUserNotificationsEnabled(env: Env): boolean {
    return (env.USER_NOTIFICATIONS_ENABLED || 'true').toLowerCase() !== 'false';
}

function getInternalApiSecret(env: Env): string {
    return String(env.INTERNAL_API_SECRET || '').trim();
}
const API_INTERNAL_SOURCE = 'api-worker';
function getInternalSource(req: Request): string {
    return String(req.headers.get('x-scoregame-internal-source') || '').trim().toLowerCase();
}
function logBotSecurityEvent(
    action: 'allow' | 'deny' | 'reject',
    route: string,
    reason?: string,
    status?: number
) {
    console.warn(`[BOT_SECURITY] ${JSON.stringify({
        action,
        route,
        reason: reason || null,
        status: status ?? null,
        at: new Date().toISOString(),
    })}`);
}
function hasTrustedApiWorkerRequest(req: Request, env: Env): boolean {
    const secret = String(req.headers.get('x-internal-secret') || '').trim();
    return !!secret && secret === getInternalApiSecret(env) && getInternalSource(req) === API_INTERNAL_SOURCE;
}
const SAFE_FALLBACK_TEXT = `⚽ ScoreGame — добро пожаловать!

Я помогу открыть приложение, настроить напоминания и присылать итоги игрового дня.

Если текст отображается некорректно, открой /menu или /help.`;
const MOJIBAKE_STRONG_MARKERS = ['вЂ', 'вЉ', 'Ã', 'Ð', 'Ñ', 'рџ', 'вљ', 'вЏ'];
// ============================================================
// Helpers: Time
// ============================================================
/** Moscow date YYYY-MM-DD (UTC+3, no DST) */
function todayMoscow(): string {
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return msk.toISOString().slice(0, 10);
}
function miniAppTabUrl(baseUrl: string, tab: string): string {
    if (tab === 'matches') return baseUrl;
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}tab=${tab}`;
}
// "Matches" is the default tab. We MUST use the exact baseUrl so Telegram does not treat it as a different web app instance.
function miniAppMatchesUrl(baseUrl: string): string { return baseUrl; }
function pluralMatches(n: number): string {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return `${n} матчей`;
    if (mod10 === 1) return `${n} матч`;
    if (mod10 >= 2 && mod10 <= 4) return `${n} матча`;
    return `${n} матчей`;
}
function miniAppRatingUrl(baseUrl: string): string { return miniAppTabUrl(baseUrl, 'rating'); }
function getBotUsername(env: Env): string {
    return String(env.BOT_USERNAME || 'scoregameee_Bot').trim().replace(/^@/, '') || 'scoregameee_Bot';
}
function miniAppStartParam(tab: string): string {
    const normalized = String(tab || 'matches').trim().toLowerCase();
    if (!normalized) return 'matches';
    if (normalized === 'home' || normalized === 'main') return 'home';
    if (normalized === 'leagues') return 'league';
    if (normalized === 'achievements' || normalized === 'quests') return 'tasks';
    return normalized;
}
function miniAppDirectUrl(env: Env, tab: string = 'matches'): string {
    const username = getBotUsername(env);
    return `https://t.me/${username}?startapp=${encodeURIComponent(miniAppStartParam(tab))}`;
}
function miniAppInlineUrlButton(env: Env, text: string, tab: string = 'matches') {
    return { text, url: miniAppDirectUrl(env, tab) };
}
const BOT_MENU_BUTTONS = {
    matches: '⚽ Открыть',
    settings: '⚙️ Настройки уведомлений',
    help: '❓ Помощь',
} as const;
// Reply-keyboard button shown next to «Выбрать канал» during the channel bind flow.
const BIND_CANCEL_BUTTON = '❌ Отменить привязку';
const BOT_SHORT_DESCRIPTION = 'Напоминания о матчах, итоги дня и быстрый вход в ScoreGame.';
const BOT_DESCRIPTION = [
    'Официальный бот ScoreGame для Telegram Mini App.',
    '',
    'Что умеет бот:',
    '• открывать приложение в нужной вкладке',
    '• присылать напоминания перед матчами',
    '• отправлять итоги игрового дня',
    '• помогать быстро перейти в меню и настройки',
    '',
    'Нажми /start, чтобы включить кнопки и открыть приложение.'
].join('\n');
function buildMainReplyKeyboard(env: Env) {
    return {
        keyboard: [
            [
                { text: BOT_MENU_BUTTONS.matches },
                { text: BOT_MENU_BUTTONS.settings },
            ],
            [
                { text: BOT_MENU_BUTTONS.help },
            ],
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: 'Матчи, уведомления или помощь',
    };
}
function activeReminderWindows(lockMs: number, nowMs: number): string[] {
    const minutesBefore = (lockMs - nowMs) / 60000;
    const windows: string[] = [];
    // Allow a small cron jitter around the target windows.
    if (minutesBefore <= 183 && minutesBefore >= 177) windows.push('T3');
    if (minutesBefore <= 63 && minutesBefore >= 57) windows.push('T60');
    if (minutesBefore <= 18 && minutesBefore >= 12) windows.push('T15');
    return windows;
}
/** Format Moscow date for display: "15 января" */
function formatDateRu(dayStr: string): string {
    const d = new Date(dayStr + 'T12:00:00Z');
    return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Moscow',
    }).format(d);
}
function looksLikeMojibake(text: string): boolean {
    if (!text) return false;
    if (MOJIBAKE_STRONG_MARKERS.some((m) => text.includes(m))) return true;
    return false;
}
function sanitizeOutgoingText(text: string, source: string, fallback: string = SAFE_FALLBACK_TEXT): string {
    if (looksLikeMojibake(text)) {
        console.warn(`Mojibake detected in ${source}, using fallback text`);
        return fallback;
    }
    return text;
}
// ============================================================
// Telegram API
// ============================================================
interface TgSendResult {
    ok: boolean;
    blocked?: boolean;
    message_id?: number;
}
async function tgApi(token: string, method: string, body: any): Promise<{ status: number; body: any }> {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    let lastStatus = 0;
    let lastBody: any = {};
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        lastStatus = res.status;
        lastBody = await res.json().catch(() => ({}));
        if (res.status === 429) {
            const retryAfter = (lastBody as any)?.parameters?.retry_after || (2 ** attempt);
            console.warn(`TG 429, retry after ${retryAfter}s`);
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
        }
        break;
    }
    return { status: lastStatus, body: lastBody };
}
// User- or provider-controlled strings (team names, league names, partner task titles)
// must be escaped before interpolation into parse_mode:'HTML' messages — otherwise a
// stray '<' makes Telegram reject the whole message.
function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
async function sendMessage(
    env: Env,
    chatId: number,
    text: string,
    replyMarkup?: any,
    parseMode: 'HTML' | undefined = 'HTML'
): Promise<TgSendResult> {
    const safeText = sanitizeOutgoingText(text, `sendMessage(chat_id=${chatId})`);
    const body: any = {
        chat_id: chatId,
        text: safeText,
    };
    if (parseMode) body.parse_mode = parseMode;
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await tgApi(env.BOT_TOKEN, 'sendMessage', body);
    // Bot blocked or chat deleted
    if (res.status === 403 || (res.status === 400 && res.body?.description?.includes('chat not found'))) {
        await env.DB.prepare('UPDATE bot_users SET active = 0 WHERE chat_id = ?').bind(chatId).run();
        return { ok: false, blocked: true };
    }
    return { ok: res.status === 200, message_id: res.body?.result?.message_id };
}
async function sendMessageToTarget(
    env: Env,
    chatId: number | string,
    text: string,
    replyMarkup?: any,
    parseMode: 'HTML' | undefined = 'HTML'
): Promise<TgSendResult & { description?: string }> {
    const safeText = sanitizeOutgoingText(text, `sendMessage(chat_id=${chatId})`);
    const body: any = {
        chat_id: chatId,
        text: safeText,
    };
    if (parseMode) body.parse_mode = parseMode;
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await tgApi(env.BOT_TOKEN, 'sendMessage', body);
    if (res.status === 403 || (res.status === 400 && String(res.body?.description || '').includes('chat not found'))) {
        if (typeof chatId === 'number') {
            await env.DB.prepare('UPDATE bot_users SET active = 0 WHERE chat_id = ?').bind(chatId).run();
        }
        return { ok: false, blocked: true, description: String(res.body?.description || '') };
    }
    return {
        ok: res.status === 200,
        message_id: res.body?.result?.message_id,
        description: String(res.body?.description || ''),
    };
}
async function clearKeyboard(env: Env, chatId: number): Promise<void> {
    const res = await tgApi(env.BOT_TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: '.',
        reply_markup: { remove_keyboard: true }
    });
    if (res.status === 200 && res.body?.result?.message_id) {
        await tgApi(env.BOT_TOKEN, 'deleteMessage', {
            chat_id: chatId,
            message_id: res.body.result.message_id
        });
    }
}
async function answerCallbackQuery(env: Env, callbackId: string, text?: string): Promise<void> {
    await tgApi(env.BOT_TOKEN, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: text || undefined,
    });
}
async function answerPreCheckoutQuery(env: Env, preCheckoutQueryId: string, ok: boolean, errorMessage?: string): Promise<void> {
    await tgApi(env.BOT_TOKEN, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: preCheckoutQueryId,
        ok,
        error_message: ok ? undefined : (errorMessage || 'Платёж не подтверждён. Попробуй позже.'),
    });
}
async function logStarOrderEvent(env: Env, orderId: string, eventType: string, payload?: unknown): Promise<void> {
    await env.DB.prepare(`
        INSERT INTO telegram_star_order_events (order_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?)
    `).bind(orderId, eventType, payload == null ? null : JSON.stringify(payload), Date.now()).run();
}
async function getStarOrderByPayload(env: Env, invoicePayload: string): Promise<any | null> {
    const row = await env.DB.prepare(`
        SELECT *
        FROM telegram_star_orders
        WHERE invoice_payload = ?
        LIMIT 1
    `).bind(String(invoicePayload || '').trim()).first() as any;
    return row || null;
}
async function getStarOrderById(env: Env, orderId: string): Promise<any | null> {
    const row = await env.DB.prepare(`
        SELECT *
        FROM telegram_star_orders
        WHERE order_id = ?
        LIMIT 1
    `).bind(String(orderId || '').trim()).first() as any;
    return row || null;
}
async function getBallBalance(env: Env, userId: number): Promise<number> {
    const row = await env.DB.prepare(`SELECT balls FROM users WHERE id = ?`).bind(userId).first() as any;
    return Number(row?.balls || 0);
}
async function getStarRefundRecoveryState(env: Env, order: any): Promise<{
    totalBalls: number;
    currentBalance: number;
    unspentPurchaseBalls: number;
    spendDetected: boolean;
}> {
    const userId = Number(order?.user_id || 0);
    const totalBalls = Math.max(0, Number(order?.total_balls || 0));
    const currentBalance = await getBallBalance(env, userId);
    const purchaseTx = await env.DB.prepare(`
        SELECT id, balance_before
        FROM ball_transactions
        WHERE user_id = ? AND open_id = ?
        LIMIT 1
    `).bind(userId, `stars_order:${String(order?.order_id || '')}`).first() as any;
    if (!purchaseTx) {
        return {
            totalBalls,
            currentBalance,
            unspentPurchaseBalls: 0,
            spendDetected: false,
        };
    }
    const spendTx = await env.DB.prepare(`
        SELECT id
        FROM ball_transactions
        WHERE user_id = ? AND id > ?
          AND amount < 0
          AND (open_id IS NULL OR open_id != ?)
        ORDER BY id ASC
        LIMIT 1
    `).bind(userId, Number(purchaseTx.id || 0), `stars_refund:${String(order?.order_id || '')}`).first() as any;
    return {
        totalBalls,
        currentBalance,
        unspentPurchaseBalls: spendTx ? 0 : totalBalls,
        spendDetected: !!spendTx,
    };
}
async function markStarOrderStatus(
    env: Env,
    orderId: string,
    status: string,
    patch?: {
        telegramPaymentChargeId?: string | null;
        providerPaymentChargeId?: string | null;
        paidAt?: number | null;
        creditedAt?: number | null;
        refundedAt?: number | null;
        lastError?: string | null;
    }
): Promise<void> {
    await env.DB.prepare(`
        UPDATE telegram_star_orders
        SET status = ?,
            telegram_payment_charge_id = COALESCE(?, telegram_payment_charge_id),
            provider_payment_charge_id = COALESCE(?, provider_payment_charge_id),
            paid_at = COALESCE(?, paid_at),
            credited_at = COALESCE(?, credited_at),
            refunded_at = COALESCE(?, refunded_at),
            last_error = ?,
            updated_at = ?
        WHERE order_id = ?
    `).bind(
        status,
        patch?.telegramPaymentChargeId ?? null,
        patch?.providerPaymentChargeId ?? null,
        patch?.paidAt ?? null,
        patch?.creditedAt ?? null,
        patch?.refundedAt ?? null,
        patch?.lastError ?? null,
        Date.now(),
        orderId
    ).run();
}
// Stage 5.4: ATOMIC purchase credit. The balls credit, the UNIQUE purchase receipt
// (ball_transactions.open_id = 'stars_order:<id>') AND the order status='credited' are written in
// ONE db.batch — so the order is NEVER 'credited' without the balls actually being credited (fixes
// X5-1). Idempotency anchor: the UNIQUE open_id. A concurrent/replayed credit makes the plain
// INSERT violate UNIQUE → the whole batch rolls back → we report already-credited. The balls amount
// is taken from the ORDER snapshot (order.total_balls), never from the Telegram payload.
export async function creditTelegramStarOrder(
    env: Env,
    order: any,
    paymentData?: { telegramPaymentChargeId?: string | null; providerPaymentChargeId?: string | null; paidAt?: number | null }
): Promise<{ credited: boolean; totalBalls: number }> {
    const orderId = String(order.order_id);
    const totalBalls = Math.max(0, Number(order.total_balls || 0));
    const userId = Number(order.user_id);
    const now = Date.now();
    const openId = `stars_order:${orderId}`;
    // Fast replay guards (truthful only after the atomic fix; legacy orphans are caught by
    // reconciliation). Never credit a refunded order.
    if (String(order.status || '') === 'refunded' || Number(order.refunded_at || 0) > 0) {
        return { credited: false, totalBalls };
    }
    const existingTx = await env.DB.prepare(`SELECT 1 AS x FROM ball_transactions WHERE open_id = ?`).bind(openId).first() as any;
    if (existingTx) {
        // Receipt exists ⇒ already credited. Heal the order status if a legacy row lagged.
        if (String(order.status || '') !== 'credited') {
            await env.DB.prepare(`UPDATE telegram_star_orders SET status='credited', credited_at = COALESCE(credited_at, ?), updated_at = ? WHERE order_id = ? AND status NOT IN ('credited','refunded')`).bind(now, now, orderId).run();
        }
        return { credited: false, totalBalls };
    }
    const beforeBalance = await getBallBalance(env, userId);
    const afterBalance = beforeBalance + totalBalls;
    const comment = `Telegram Stars: ${String(order.pack_title || order.pack_code || 'pack')} (${Number(order.price_xtr || 0)} XTR)`;
    try {
        await env.DB.batch([
            env.DB.prepare(`UPDATE users SET balls = balls + ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ball_transactions WHERE open_id = ?)`).bind(totalBalls, userId, openId),
            env.DB.prepare(`INSERT INTO ball_transactions (user_id, amount, balance_before, balance_after, operation_type, comment, open_id, created_at) VALUES (?, ?, ?, ?, 'telegram_star_purchase', ?, ?, ?)`).bind(userId, totalBalls, beforeBalance, afterBalance, comment, openId, now),
            env.DB.prepare(`UPDATE telegram_star_orders
                SET status='credited',
                    telegram_payment_charge_id = COALESCE(?, telegram_payment_charge_id),
                    provider_payment_charge_id = COALESCE(?, provider_payment_charge_id),
                    paid_at = COALESCE(?, paid_at), credited_at = ?, last_error = NULL, updated_at = ?
                WHERE order_id = ? AND status NOT IN ('credited','refunded')`)
                .bind(paymentData?.telegramPaymentChargeId ?? null, paymentData?.providerPaymentChargeId ?? null, paymentData?.paidAt ?? now, now, now, orderId),
        ]);
    } catch (e: any) {
        if (String(e?.message || e || '').includes('UNIQUE constraint failed: ball_transactions.open_id')) {
            return { credited: false, totalBalls }; // concurrent/replay already credited
        }
        throw e;
    }
    await logStarOrderEvent(env, orderId, 'credited', {
        total_balls: totalBalls,
        telegram_payment_charge_id: paymentData?.telegramPaymentChargeId ?? null,
        provider_payment_charge_id: paymentData?.providerPaymentChargeId ?? null,
    });
    return { credited: true, totalBalls };
}
// Stage 5.4 + 5.4.1: ATOMIC refund. The recoverable-balls deduction, the UNIQUE refund receipt
// (ball_transactions.open_id = 'stars_refund:<id>') AND the order status='refunded' are written in
// ONE db.batch — so the order is NEVER 'refunded' without the deduction, and the receipt anchor is
// always written (even for zero recovery) so a replay is idempotent.
//
// X5-3 fix — refund is gated on PROOF OF CREDIT for THIS order. recoverable is computed ONLY when a
// matching purchase receipt exists (ball_transactions.open_id='stars_order:<id>', amount=total_balls,
// same user). Without that proof this is a REFUNDED_BEFORE_CREDIT: recovered=0, NO balance change
// (we never credited anything, so we never touch the user's other balls). With proof:
//   recovered = min(current_balance, credited_amount); balance never negative; unrecovered remainder
//   recorded as PARTIAL_BALLS_RECOVERY; no debt. One refund receipt per order; replay = no-op.
export async function refundTelegramStarOrder(env: Env, order: any, payment?: any): Promise<void> {
    const orderId = String(order.order_id);
    const userId = Number(order.user_id);
    const refundOpenId = `stars_refund:${orderId}`;
    const now = Date.now();
    const totalBalls = Math.max(0, Number(order.total_balls || 0));

    // Fast replay: a refund receipt already exists ⇒ done. Heal the order status if it lagged.
    const existingRefundTx = await env.DB.prepare(`SELECT amount FROM ball_transactions WHERE open_id = ? LIMIT 1`).bind(refundOpenId).first() as any;
    if (existingRefundTx) {
        if (String(order.status || '') !== 'refunded') {
            await markStarOrderStatus(env, orderId, 'refunded', {
                refundedAt: now,
                lastError: Math.abs(Number(existingRefundTx.amount || 0)) < totalBalls ? 'PARTIAL_BALLS_RECOVERY' : null,
            });
        }
        return;
    }

    // Proof of credit for THIS order: the purchase receipt must exist with the snapshot amount + owner.
    const purchaseTx = await env.DB.prepare(`SELECT amount, user_id FROM ball_transactions WHERE open_id = ? LIMIT 1`).bind(`stars_order:${orderId}`).first() as any;
    const creditedProof = !!purchaseTx && Number(purchaseTx.amount || 0) === totalBalls && Number(purchaseTx.user_id || -1) === userId;
    const beforeBalance = await getBallBalance(env, userId);
    // Refund-before-credit (no proof): recover nothing, leave the user's existing balance untouched.
    const refundAmount = creditedProof ? Math.min(totalBalls, beforeBalance) : 0;
    const afterBalance = Math.max(0, beforeBalance - refundAmount);
    const reason = !creditedProof ? 'REFUNDED_BEFORE_CREDIT' : (refundAmount < totalBalls ? 'PARTIAL_BALLS_RECOVERY' : null);
    try {
        await env.DB.batch([
            // Deduct only if a refund receipt does not yet exist and there is something to recover.
            env.DB.prepare(`UPDATE users SET balls = MAX(0, balls - ?) WHERE id = ? AND ? > 0 AND NOT EXISTS (SELECT 1 FROM ball_transactions WHERE open_id = ?)`).bind(refundAmount, userId, refundAmount, refundOpenId),
            // Receipt anchor (UNIQUE open_id) — written even for zero recovery so replays are idempotent.
            env.DB.prepare(`INSERT INTO ball_transactions (user_id, amount, balance_before, balance_after, operation_type, comment, open_id, created_at) VALUES (?, ?, ?, ?, 'telegram_star_refund', ?, ?, ?)`)
                .bind(userId, -refundAmount, beforeBalance, afterBalance, `Refund Telegram Stars: ${String(order.pack_title || order.pack_code || 'pack')}`, refundOpenId, now),
            env.DB.prepare(`UPDATE telegram_star_orders
                SET status='refunded',
                    telegram_payment_charge_id = COALESCE(?, telegram_payment_charge_id),
                    provider_payment_charge_id = COALESCE(?, provider_payment_charge_id),
                    refunded_at = ?, last_error = ?, updated_at = ?
                WHERE order_id = ? AND status != 'refunded'`)
                .bind(payment?.telegram_payment_charge_id ?? null, payment?.provider_payment_charge_id ?? null, now, reason, now, orderId),
        ]);
    } catch (e: any) {
        if (String(e?.message || e || '').includes('UNIQUE constraint failed: ball_transactions.open_id')) {
            return; // concurrent/replay refund already processed
        }
        throw e;
    }
    // recovered/unrecovered snapshot is auditable from the event + the refund tx amount (no schema change).
    await logStarOrderEvent(env, orderId, !creditedProof ? 'refunded_before_credit' : 'refunded', {
        refunded_payment: payment || null,
        recovered_balls: refundAmount,
        unrecovered_balls: Math.max(0, totalBalls - refundAmount),
        total_balls: totalBalls,
        refund_reason: reason,
    });
    await notifyAdminsAboutStarOrder(env, 'refund', order, {
        totalBalls,
        deductedBalls: refundAmount,
        requestedByAdmin: !!payment?.requested_by_admin,
        adminUserId: Number.isFinite(Number(payment?.admin_user_id)) ? Number(payment.admin_user_id) : null,
    });
}
async function editMessageText(
    env: Env,
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: any,
    parseMode: 'HTML' | undefined = 'HTML'
): Promise<void> {
    const safeText = sanitizeOutgoingText(text, `editMessageText(chat_id=${chatId}, message_id=${messageId})`);
    const body: any = {
        chat_id: chatId,
        message_id: messageId,
        text: safeText,
    };
    if (parseMode) body.parse_mode = parseMode;
    if (replyMarkup) body.reply_markup = replyMarkup;
    await tgApi(env.BOT_TOKEN, 'editMessageText', body);
}
// ============================================================
// Inline Keyboards
// ============================================================
type ReminderMode = 'OFF' | 'T15' | 'T60_T15' | 'T60_T15_T3';
const VALID_MODES: ReminderMode[] = ['OFF', 'T15', 'T60_T15', 'T60_T15_T3'];
function normalizeMode(mode: string | undefined | null): ReminderMode {
    return VALID_MODES.includes(mode as ReminderMode) ? (mode as ReminderMode) : 'T15';
}
function buildSettingsKeyboard(currentMode: string): any[][] {
    const mode = normalizeMode(currentMode);
    const modeLabel = (id: ReminderMode): string => {
        switch (id) {
            case 'OFF':
                return mode === 'OFF' ? '✅ Выключены' : 'Выключены';
            case 'T15':
                return mode === 'T15' ? '✅ За 15 минут' : 'За 15 минут';
            case 'T60_T15':
                return mode === 'T60_T15' ? '✅ За 60 и 15 минут' : 'За 60 и 15 минут';
            case 'T60_T15_T3':
                return mode === 'T60_T15_T3' ? '✅ За 3 часа, 60 и 15 минут' : 'За 3 часа, 60 и 15 минут';
        }
    };
    const button = (id: ReminderMode) => ({
        text: modeLabel(id),
        callback_data: `mode:${id}`,
    });
    return [
        [button('OFF')],
        [button('T15')],
        [button('T60_T15')],
        [button('T60_T15_T3')],
    ];
}
function buildSettingsReplyMarkup(settings: UserSettings, env: Env): any {
    const summaryOn = Number(settings.summary_enabled) !== 0;
    const poOn = Number(settings.predictions_open_enabled) !== 0;
    return {
        inline_keyboard: [
            ...buildSettingsKeyboard(normalizeMode(settings.mode)),
            [{ text: `📣 Анонс матчей дня: ${poOn ? '✅ вкл' : '❌ выкл'}`, callback_data: 'toggle:po' }],
            [{ text: `📊 Итоги дня: ${summaryOn ? '✅ вкл' : '❌ выкл'}`, callback_data: 'toggle:summary' }],
            [
                { text: '🔙 В меню', callback_data: 'OPEN_MENU' },
                { text: '⚽ Открыть матчи', web_app: { url: miniAppMatchesUrl(env.MINIAPP_URL) } }
            ],
        ],
    };
}
function settingsText(mode: string): string {
    const modeNames: Record<string, string> = {
        OFF: 'уведомления выключены',
        T15: 'за 15 минут до матча',
        T60_T15: 'за 60 и 15 минут до матча',
        T60_T15_T3: 'за 3 часа, 60 и 15 минут до матча',
    };
    return `⚙️ Настройки уведомлений

Напоминания о дедлайне: ${modeNames[mode] || mode}

Ниже можно выбрать режим напоминаний и отдельно отключить утренний анонс матчей и вечерние итоги дня.`;
}
async function sendOrEditSettingsMenu(
    env: Env,
    chatId: number,
    userId: number,
    messageId?: number
): Promise<void> {
    const settings = await getOrCreateSettings(env, userId);
    const mode = normalizeMode(settings.mode);
    const text = settingsText(mode);
    const replyMarkup = buildSettingsReplyMarkup(settings, env);
    if (messageId) {
        await editMessageText(env, chatId, messageId, text, replyMarkup, undefined);
    } else {
        await sendMessage(env, chatId, text, replyMarkup, undefined);
    }
}
// ============================================================
// Admin check
// ============================================================
function isAdmin(env: Env, userId: number): boolean {
    const ids = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    return ids.includes(String(userId));
}
function getAdminIds(env: Env): number[] {
    return String(env.ADMIN_IDS || '')
        .split(',')
        .map((value) => Number(String(value || '').trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
}
async function hasStarOrderEvent(env: Env, orderId: string, eventType: string): Promise<boolean> {
    const row = await env.DB.prepare(`
        SELECT 1
        FROM telegram_star_order_events
        WHERE order_id = ?
          AND event_type = ?
        LIMIT 1
    `).bind(orderId, eventType).first() as any;
    return !!row;
}
async function notifyAdminsAboutStarOrder(
    env: Env,
    kind: 'purchase' | 'refund',
    order: any,
    details?: {
        totalBalls?: number;
        deductedBalls?: number;
        requestedByAdmin?: boolean;
        adminUserId?: number | null;
    }
): Promise<void> {
    const orderId = String(order?.order_id || '').trim();
    if (!orderId) return;
    const eventType = kind === 'purchase' ? 'admin_purchase_notified' : 'admin_refund_notified';
    if (await hasStarOrderEvent(env, orderId, eventType)) {
        return;
    }
    const adminIds = getAdminIds(env);
    if (!adminIds.length) return;
    const userId = Number(order?.user_id || 0);
    const userRow = await env.DB.prepare(`
        SELECT username, first_name
        FROM users
        WHERE id = ?
        LIMIT 1
    `).bind(userId).first() as any;
    const username = String(userRow?.username || '').trim();
    const firstName = String(userRow?.first_name || '').trim();
    const buyerLabel = username ? `@${username}` : (firstName || `user ${userId}`);
    const packTitle = String(order?.pack_title || order?.pack_code || 'Stars pack').trim();
    const totalBalls = Math.max(0, Number(details?.totalBalls ?? order?.total_balls ?? 0));
    const deductedBalls = Math.max(0, Number(details?.deductedBalls ?? 0));
    const priceXtr = Math.max(0, Number(order?.price_xtr || 0));
    let text = '';
    if (kind === 'purchase') {
        text =
`⭐ Покупка Telegram Stars
Пользователь: ${buyerLabel} (${userId})
Пак: ${packTitle}
Оплата: ${priceXtr} XTR
Начислено: ${totalBalls} мячиков
Заказ: ${orderId}`;
    } else {
        const sourceLabel = details?.requestedByAdmin
            ? `Инициатор: ${details?.adminUserId ? details.adminUserId : 'manual'}`
            : 'Инициировано: Telegram refund';
        text =
`🔄 Возврат Telegram Stars
Пользователь: ${buyerLabel} (${userId})
Пак: ${packTitle}
Возврат: ${priceXtr} XTR
Списано мячиков: ${deductedBalls}/${totalBalls}
${sourceLabel}
Заказ: ${orderId}`;
    }
    let sent = 0;
    for (const adminId of adminIds) {
        const result = await sendMessage(env, adminId, text, undefined, undefined);
        if (result.ok) sent += 1;
    }
    if (sent > 0) {
        await logStarOrderEvent(env, orderId, eventType, {
            sent,
            kind,
            user_id: userId,
            price_xtr: priceXtr,
            total_balls: totalBalls,
            deducted_balls: deductedBalls,
        });
    }
}
async function syncTelegramBotProfile(env: Env): Promise<any> {
    const commands = [
        { command: 'start', description: 'Открыть ScoreGame' },
        { command: 'help', description: 'Справка и возможности' },
        { command: 'menu', description: 'Быстрое меню' },
        { command: 'matches', description: 'Открыть' },
        { command: 'settings', description: 'Настроить уведомления' },
    ];
    // Admin-only commands (/broadcast, /predictions_open_resend, /maintenance_*) are
    // deliberately NOT registered: default-scope commands are visible to every user.
    const commandsRes = await tgApi(env.BOT_TOKEN, 'setMyCommands', { commands });
    
    const descriptionRes = await tgApi(env.BOT_TOKEN, 'setMyDescription', {
        description: BOT_DESCRIPTION
    });
    const shortDescriptionRes = await tgApi(env.BOT_TOKEN, 'setMyShortDescription', {
        short_description: BOT_SHORT_DESCRIPTION
    });
    // Глобальная кнопка (без chat_id) — та, что видит человек, ещё не нажавший
    // /start. Держим её обычным меню команд намеренно: кнопка «Открыть» должна
    // появляться только после старта, когда заведён bot_users и бот уже может
    // писать. Персональную web_app-кнопку ставит handleStartCommand.
    const menuButtonRes = await tgApi(env.BOT_TOKEN, 'setChatMenuButton', {
        menu_button: { type: 'default' }
    });
    return {
        commands: commandsRes.body,
        description: descriptionRes.body,
        shortDescription: shortDescriptionRes.body,
        menuButton: menuButtonRes.body
    };
}
// ============================================================
// Webhook: /start, /settings, callbacks
// ============================================================
async function handleWebhook(req: Request, env: Env): Promise<Response> {
    // Telegram must be configured with setWebhook(..., secret_token=WEBHOOK_SECRET).
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (secret !== env.WEBHOOK_SECRET) {
        logBotSecurityEvent('deny', '/tg/webhook', 'invalid_webhook_secret', 401);
        return new Response('Unauthorized', { status: 401 });
    }
    let update: any;
    try {
        update = await req.json();
    } catch {
        return new Response('Bad JSON', { status: 400 });
    }
    try {
        if (update.pre_checkout_query) {
            await handlePreCheckoutQuery(env, update.pre_checkout_query);
        } else if (update.message?.successful_payment) {
            await handleSuccessfulPayment(env, update.message);
        } else if (update.message?.refunded_payment) {
            await handleRefundedPayment(env, update.message);
        } else if (update.message?.text) {
            await handleMessage(env, update.message);
        } else if (update.message?.chat_shared) {
            await handleChatShared(env, update.message);
        } else if (update.callback_query) {
            await handleCallback(env, update.callback_query);
        }
    } catch (e) {
        console.error('Webhook handler error:', e);
    }
    return new Response('ok');
}
async function handlePreCheckoutQuery(env: Env, query: any): Promise<void> {
    const invoicePayload = String(query?.invoice_payload || '').trim();
    const currency = String(query?.currency || '').trim().toUpperCase();
    const totalAmount = Number(query?.total_amount || 0);
    try {
        const order = await getStarOrderByPayload(env, invoicePayload);
        if (!order) {
            await answerPreCheckoutQuery(env, String(query.id), false, 'Платёж не найден. Оформи покупку заново.');
            return;
        }
        if (currency !== 'XTR' || totalAmount !== Number(order.price_xtr || 0)) {
            await markStarOrderStatus(env, String(order.order_id), 'failed', {
                lastError: `PRECHECK_MISMATCH:${currency}:${totalAmount}`,
            });
            await logStarOrderEvent(env, String(order.order_id), 'pre_checkout_rejected', {
                currency,
                total_amount: totalAmount,
                expected_xtr: Number(order.price_xtr || 0),
            });
            await answerPreCheckoutQuery(env, String(query.id), false, 'Данные платежа не совпали. Оформи покупку заново.');
            return;
        }
        await markStarOrderStatus(env, String(order.order_id), 'pre_checkout_approved', { lastError: null });
        await logStarOrderEvent(env, String(order.order_id), 'pre_checkout_approved', {
            pre_checkout_query_id: query?.id || null,
            currency,
            total_amount: totalAmount,
        });
        await answerPreCheckoutQuery(env, String(query.id), true);
    } catch (e: any) {
        console.error('Pre-checkout handler error:', e);
        await answerPreCheckoutQuery(env, String(query?.id || ''), false, 'Не удалось обработать платёж. Попробуй позже.');
    }
}
async function handleSuccessfulPayment(env: Env, msg: any): Promise<void> {
    const payment = msg?.successful_payment;
    const invoicePayload = String(payment?.invoice_payload || '').trim();
    if (!invoicePayload) return;
    const from = msg?.from;
    if (from?.id && msg?.chat?.id) {
        await upsertBotUser(env, Number(from.id), Number(msg.chat.id), from.username, from.first_name);
    }
    const order = await getStarOrderByPayload(env, invoicePayload);
    if (!order) {
        console.warn(`[STARS] successful_payment for unknown payload=${invoicePayload}`);
        return;
    }
    await logStarOrderEvent(env, String(order.order_id), 'successful_payment', payment || null);

    // Stage 5.4 + 5.4.1: validate the Telegram payment against the ORDER snapshot before crediting.
    // The amount / currency / owner come from telegram_star_orders, never from the client payload.
    // X5-4: a conflicting/forged update must NOT change the order status — otherwise it could block a
    // later legitimate payment. We only record a payment_conflict event and refuse to credit.
    const expectedXtr = Number(order.price_xtr || 0);
    const gotCurrency = String(payment?.currency || '');
    const gotAmount = Number(payment?.total_amount || 0);
    const ownerId = Number(order.user_id || 0);
    const payerId = Number(from?.id || 0);
    const chargeId = String(payment?.telegram_payment_charge_id || '').trim();
    // A Telegram charge already bound to a DIFFERENT order is a conflict (no second use).
    let chargeConflict = false;
    if (chargeId) {
        const other = await env.DB.prepare(`SELECT order_id FROM telegram_star_orders WHERE telegram_payment_charge_id = ? AND order_id != ? LIMIT 1`).bind(chargeId, String(order.order_id)).first() as any;
        chargeConflict = !!other;
    }
    if (gotCurrency !== 'XTR' || gotAmount !== expectedXtr || (payerId && ownerId && payerId !== ownerId) || chargeConflict) {
        await logStarOrderEvent(env, String(order.order_id), 'payment_conflict', {
            currency: gotCurrency, amount: gotAmount, expected_xtr: expectedXtr, payer_id: payerId, owner_id: ownerId,
            charge_conflict: chargeConflict, reason: 'TELEGRAM_STARS_PAYMENT_CONFLICT',
        });
        // Do NOT credit and do NOT change order status — a later correct payment must still be able to proceed.
        return;
    }

    try {
        const credited = await creditTelegramStarOrder(env, order, {
            telegramPaymentChargeId: payment?.telegram_payment_charge_id || null,
            providerPaymentChargeId: payment?.provider_payment_charge_id || null,
            paidAt: Date.now(),
        });
        console.log(`[STARS] order=${order.order_id} credited=${credited.credited} balls=${credited.totalBalls}`);
        if (credited.credited) {
            await notifyAdminsAboutStarOrder(env, 'purchase', order, {
                totalBalls: credited.totalBalls,
            });
        }
    } catch (e: any) {
        console.error(`[STARS] credit failed order=${order.order_id}:`, e);
        await markStarOrderStatus(env, String(order.order_id), 'failed', {
            telegramPaymentChargeId: payment?.telegram_payment_charge_id || null,
            providerPaymentChargeId: payment?.provider_payment_charge_id || null,
            paidAt: Date.now(),
            lastError: String(e?.message || e || 'credit_failed'),
        });
        await logStarOrderEvent(env, String(order.order_id), 'credit_failed', {
            error: String(e?.message || e || 'credit_failed'),
        });
    }
}
async function handleRefundedPayment(env: Env, msg: any): Promise<void> {
    const payment = msg?.refunded_payment;
    const chargeId = String(payment?.telegram_payment_charge_id || '').trim();
    if (!chargeId) return;
    const order = await env.DB.prepare(`
        SELECT *
        FROM telegram_star_orders
        WHERE telegram_payment_charge_id = ?
        LIMIT 1
    `).bind(chargeId).first() as any;
    if (!order) {
        console.warn(`[STARS] refunded_payment for unknown charge=${chargeId}`);
        return;
    }
    try {
        await refundTelegramStarOrder(env, order, payment);
    } catch (e: any) {
        console.error(`[STARS] refund failed order=${order.order_id}:`, e);
        await markStarOrderStatus(env, String(order.order_id), 'failed', {
            lastError: `REFUND_FAILED:${String(e?.message || e || 'unknown')}`,
        });
        await logStarOrderEvent(env, String(order.order_id), 'refund_failed', {
            error: String(e?.message || e || 'unknown'),
            refunded_payment: payment || null,
        });
    }
}
async function handleMessage(env: Env, msg: any): Promise<void> {
    const text = (msg.text || '').trim();
    const chatId = msg.chat.id;
    const from = msg.from;
    if (!from) return;
    // [A] Base per-user inbound throttle (admins exempt — they may legitimately
    // burst commands). Over the limit ⇒ silently drop this update.
    if (!isAdmin(env, Number(from.id)) && await isRateLimited(RL_MSG.bucket, from.id, RL_MSG.limit, RL_MSG.windowMs)) {
        return;
    }
    // --- Partner task deep link (MUST be before generic /start) ---
    if (text.startsWith('/start partner_')) {
        // [B] Tight limit on token-bearing deep links — blunts verify_token
        // brute-forcing and partner_events spam. Silent drop over the limit.
        if (await isRateLimited(RL_VERIFY.bucket, from.id, RL_VERIFY.limit, RL_VERIFY.windowMs)) return;
        await handlePartnerTaskStart(env, from, chatId, text);
        return;
    // --- Channel bind deep link (MUST be before generic /start) ---
    } else if (text.startsWith('/start bind_channel_')) {
        // [B] Same tight limit for bind-token deep links.
        if (await isRateLimited(RL_VERIFY.bucket, from.id, RL_VERIFY.limit, RL_VERIFY.windowMs)) return;
        const token = text.replace('/start bind_channel_', '').trim();
        await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
        if (!token) {
            await sendMessage(env, chatId, '❌ Некорректная ссылка. Повтори привязку через приложение.');
            return;
        }
        // Verify pending bind exists
        const bind = await env.DB.prepare(
            `SELECT * FROM pending_channel_binds WHERE token = ? AND telegram_user_id = ? AND status = 'pending'`
        ).bind(token, from.id).first() as any;
        if (!bind) {
            await sendMessage(env, chatId, '❌ Ссылка привязки недействительна. Повтори привязку через приложение.');
            return;
        }
        if (bind.expires_at < Date.now()) {
            await env.DB.prepare(`UPDATE pending_channel_binds SET status = 'expired' WHERE id = ?`).bind(bind.id).run();
            await sendMessage(env, chatId, '❌ Срок действия ссылки привязки истёк. Повтори привязку через приложение.');
            return;
        }
        await sendMessage(
            env,
            chatId,
            `🔗 <b>Привязка канала к лиге</b>\n\n` +
            `Нажми кнопку ниже, чтобы выбрать нужный Telegram-канал.\n` +
            `Выбирай канал, где ты администратор.\n` +
            `Боту не нужен доступ к каналу на время привязки.\n\n` +
            `Передумал — нажми «${BIND_CANCEL_BUTTON}». Ваучер дополнительной лиги не спишется до создания лиги.`,
            buildBindReplyKeyboard(),
        );
        // --- Generic /start ---
    } else if (text.startsWith('/')) {
        const fullCmd = text.split(/\s+/)[0].toLowerCase();
        const cmd = fullCmd.split('@')[0]; // Remove bot mention
        switch (cmd) {
            case '/start':
                await handleStartCommand(env, msg, from, chatId);
                return;
            case '/help':
                await handleHelpCommand(env, chatId);
                return;
            case '/menu':
                await handleMenuCommand(env, chatId);
                return;
            case '/matches':
                await handleDirectLaunchCommand(env, chatId, 'matches', '\u26BD \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435');
                return;
            case '/rating':
                await handleDirectLaunchCommand(env, chatId, 'rating', '\uD83C\uDFC6 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0440\u0435\u0439\u0442\u0438\u043D\u0433');
                return;
            case '/profile':
                await handleDirectLaunchCommand(env, chatId, 'profile', '\uD83D\uDC64 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C');
                return;
            case '/tasks':
                await handleDirectLaunchCommand(env, chatId, 'tasks', '\uD83D\uDCCB \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0437\u0430\u0434\u0430\u043D\u0438\u044F');
                return;
            case '/leagues':
                await handleDirectLaunchCommand(env, chatId, 'leagues', '\uD83D\uDC65 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043B\u0438\u0433\u0438');
                return;
            case '/settings':
                await handleSettingsCommand(env, msg, from, chatId);
                return;
            case '/maintenance_start':
                await handleMaintenanceStart(env, msg, from, chatId);
                return;
            case '/maintenance_end':
                await handleMaintenanceEnd(env, msg, from, chatId);
                return;
            case '/maintenance_status':
                await handleMaintenanceStatus(env, msg, from, chatId);
                return;
            case '/sync_avatars':
                await handleSyncAvatars(env, msg, from, chatId);
                return;
            case '/sync_bot_profile':
                await handleSyncBotProfile(env, msg, from, chatId);
                return;
            case '/channelpost':
                await handleChannelPostCommand(env, msg, from, chatId, { withPlayButton: false });
                return;
            case '/channelpostplay':
                await handleChannelPostCommand(env, msg, from, chatId, { withPlayButton: true });
                return;
            case '/broadcast':
                await handleBroadcastCommand(env, msg, from, chatId);
                return;
            case '/predictions_open_resend':
                await handlePredictionsOpenResend(env, msg, from, chatId);
                return;
            default:
                await sendMessage(env, chatId, 'Неизвестная команда. Открой /menu или /help — там список команд.');
                return;
        }
    }
    if (text === BIND_CANCEL_BUTTON) {
        await handleBindCancel(env, from, chatId);
        return;
    }
    if (text === BOT_MENU_BUTTONS.matches || text.replace(/\s+$/, '') === BOT_MENU_BUTTONS.matches.replace(/\s+$/, '')) {
        // Reply with an inline_keyboard web_app button so Telegram provides initData reliably
        await sendMessage(env, chatId, '⚽ Открывай ScoreGame:', {
            inline_keyboard: [
                [miniAppInlineUrlButton(env, '⚽ Открыть приложение', 'home')]
            ]
        });
        return;
    }
    if (text === BOT_MENU_BUTTONS.settings) {
        await handleSettingsCommand(env, msg, from, chatId);
        return;
    }
    if (text === BOT_MENU_BUTTONS.help) {
        await handleHelpCommand(env, chatId);
        return;
    }
}
// ============================================================
// Handle chat_shared events (channel bind flow)
// ============================================================
// Command Handlers
// ============================================================
async function handleStartCommand(env: Env, msg: any, from: any, chatId: number) {
    await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
    await setPersonalMenuButton(env, chatId);
    await sendBotWelcomeMessage(env, from.id, chatId);
    await sendMessage(
        env,
        chatId,
        '\u0413\u043b\u0430\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u044b \u0443\u0436\u0435 \u0432\u043d\u0438\u0437\u0443: \u043e\u0442\u043a\u0440\u043e\u0439 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435, \u043d\u0430\u0441\u0442\u0440\u043e\u0439 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u0438\u043b\u0438 \u0437\u0430\u0433\u043b\u044f\u043d\u0438 \u0432 \u043f\u043e\u043c\u043e\u0449\u044c.',
        buildMainReplyKeyboard(env),
        undefined
    );
}
async function sendBotWelcomeMessage(env: Env, userId: number, chatId: number): Promise<TgSendResult> {
    await getOrCreateSettings(env, userId);
    let maintenanceBanner = '';
    try {
        const mc = await getAppMaintenanceConfig(env);
        if (mc.enabled) {
            maintenanceBanner = `

\u26A0\uFE0F <b>\u0421\u0435\u0439\u0447\u0430\u0441 \u0438\u0434\u0443\u0442 \u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0440\u0430\u0431\u043e\u0442\u044b</b>
${escapeHtml(mc.message)}`;
        }
    } catch { }
    return sendMessage(
        env,
        chatId,
        `\u26BD <b>ScoreGame \u2014 \u0434\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u043e\u0432\u0430\u0442\u044c!</b>

\u042F \u043f\u043e\u043c\u043e\u0433\u0443 \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435, \u043d\u0430\u0441\u0442\u0440\u043e\u0438\u0442\u044c \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u0438 \u043f\u0440\u0438\u0441\u044b\u043b\u0430\u0442\u044c \u0438\u0442\u043e\u0433\u0438 \u0438\u0433\u0440\u043e\u0432\u043e\u0433\u043e \u0434\u043d\u044f.${maintenanceBanner}

\u041d\u0430\u0436\u043c\u0438 \u00ab\u041e\u0442\u043a\u0440\u044b\u0442\u044c\u00bb, \u0447\u0442\u043e\u0431\u044b \u043f\u0435\u0440\u0435\u0439\u0442\u0438 \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435, \u0438\u043b\u0438 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439 /menu.`,
        { inline_keyboard: [[miniAppInlineUrlButton(env, '\u041e\u0442\u043a\u0440\u044b\u0442\u044c', 'home')]] },
        undefined
    );
}
function isPrivateAdminCommand(env: Env, from: any, msg: any): boolean {
    return !!from && isAdmin(env, Number(from.id || 0)) && String(msg?.chat?.type || '') === 'private';
}
function extractCommandPayload(text: string, command: string): string {
    return String(text || '').replace(new RegExp(`^${command}(?:@\\w+)?\\s*`, 'i'), '').trim();
}
async function handleHelpCommand(env: Env, chatId: number): Promise<void> {
    await sendMessage(
        env,
        chatId,
        `⚽ ScoreGame\n\n` +
        `Доступные команды:\n` +
        `/start — открыть бота\n` +
        `/matches — открыть матчи\n` +
        `/settings — настройки уведомлений\n` +
        `/menu — главное меню`,
        buildMainReplyKeyboard(env)
    );
}
async function handleMenuCommand(env: Env, chatId: number): Promise<void> {
    await sendMessage(env, chatId, 'Открываю главное меню.', buildMainReplyKeyboard(env));
}
async function handleDirectLaunchCommand(env: Env, chatId: number, tab: string, label: string): Promise<void> {
    await sendMessage(env, chatId, `${label}:`, {
        inline_keyboard: [
            [miniAppInlineUrlButton(env, label, tab)]
        ]
    });
}
async function handleSettingsCommand(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
    await sendOrEditSettingsMenu(env, chatId, from.id);
}
// The app's maintenance gate reads app_config ('maintenance_enabled'/'maintenance_message')
// in api-worker — the bot commands must write the SAME keys, otherwise the bot reports
// maintenance as on while the app keeps serving users. maintenance_state is legacy and
// is no longer written or read here. api-worker's in-memory maintenance cache has a 15s
// TTL, so a bot-side toggle takes effect in the app within ~15 seconds.
async function setAppMaintenanceConfig(env: Env, enabled: boolean, message?: string): Promise<void> {
    const now = Date.now();
    const upsert = (key: string, value: string) => env.DB.prepare(
        `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    ).bind(key, value, now);
    const stmts = [upsert('maintenance_enabled', enabled ? '1' : '0')];
    if (message !== undefined) stmts.push(upsert('maintenance_message', message));
    await env.DB.batch(stmts);
}
async function getAppMaintenanceConfig(env: Env): Promise<{ enabled: boolean; message: string }> {
    const res = await env.DB.prepare(
        `SELECT key, value FROM app_config WHERE key IN ('maintenance_enabled','maintenance_message')`
    ).all();
    const map = Object.fromEntries(((res.results || []) as any[]).map((r) => [String(r.key), String(r.value ?? '')]));
    return {
        enabled: map['maintenance_enabled'] === '1',
        message: map['maintenance_message'] || 'Технические работы',
    };
}
async function handleMaintenanceStart(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    const text = extractCommandPayload(String(msg?.text || ''), '/maintenance_start') || 'Идут технические работы.';
    await setAppMaintenanceConfig(env, true, text);
    await env.DB.prepare(`INSERT INTO maintenance_events (type, message, created_at) VALUES ('START', ?, ?)`).bind(text, Date.now()).run();
    await sendMessage(env, chatId, `✅ Режим техработ включён: приложение закрыто для пользователей.\n\nСообщение:\n${text}`, undefined, undefined);
}
async function handleMaintenanceEnd(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    await setAppMaintenanceConfig(env, false);
    await env.DB.prepare(`INSERT INTO maintenance_events (type, message, created_at) VALUES ('END', NULL, ?)`).bind(Date.now()).run();
    await sendMessage(env, chatId, '✅ Режим техработ выключен: приложение снова открыто.');
}
async function handleMaintenanceStatus(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    const mc = await getAppMaintenanceConfig(env);
    if (!mc.enabled) {
        await sendMessage(env, chatId, 'ℹ️ Техработы сейчас выключены.');
        return;
    }
    await sendMessage(env, chatId, `⚠️ Техработы активны.\n\nСообщение:\n${mc.message}`, undefined, undefined);
}
async function handleSyncAvatars(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    await sendMessage(env, chatId, 'ℹ️ Команда sync_avatars сейчас не используется.');
}
async function handleSyncBotProfile(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    const result = await syncTelegramBotProfile(env);
    await sendMessage(env, chatId, `✅ Профиль бота синхронизирован.\n\n${escapeHtml(JSON.stringify(result))}`);
}
async function handleChannelPostCommand(env: Env, msg: any, from: any, chatId: number, opts: { withPlayButton: boolean }): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    const text = String(msg?.text || '');
    const firstLineBreak = text.indexOf('\n');
    const header = firstLineBreak >= 0 ? text.slice(0, firstLineBreak).trim() : text.trim();
    const body = firstLineBreak >= 0 ? text.slice(firstLineBreak + 1).trim() : '';
    const parts = header.split(/\s+/);
    const target = parts[1];
    if (!target || !body) {
        await sendMessage(env, chatId, 'Используйте формат:\n/channelpost @channel\\nТекст поста');
        return;
    }
    const replyMarkup = opts.withPlayButton ? {
        inline_keyboard: [[
            { text: 'Играть', url: `https://t.me/${getBotUsername(env)}?startapp=channel_post` }
        ]]
    } : undefined;
    const tgRes = await tgApi(env.BOT_TOKEN, 'sendMessage', {
        chat_id: target,
        text: body,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
    if (tgRes.status === 200 && tgRes.body?.ok) {
        await sendMessage(env, chatId, `✅ Пост отправлен в ${target}.`);
    } else {
        await sendMessage(env, chatId, `❌ Не удалось отправить пост: ${escapeHtml(tgRes.body?.description || tgRes.status)}`);
    }
}
async function handleBroadcastCommand(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    if (!isUserNotificationsEnabled(env)) {
        await sendMessage(env, chatId, '⚠️ Массовые уведомления отключены: USER_NOTIFICATIONS_ENABLED=false.\nЧтобы включить, измените конфигурацию.');
        return;
    }
    const body = extractCommandPayload(String(msg?.text || ''), '/broadcast');
    if (!body) {
        await sendMessage(env, chatId, 'Используйте формат:\n/broadcast\nТекст рассылки');
        return;
    }
    // Length cap mirrors the admin panel (api-worker /admin/broadcast) so an
    // over-long message is rejected up front instead of failing per-recipient.
    if (body.length > 3500) {
        await sendMessage(env, chatId, `⚠️ Текст рассылки слишком длинный (${body.length} символов). Максимум — 3500.`);
        return;
    }
    // Enqueue a broadcast_jobs row instead of sending synchronously. The cron
    // drainer (processBroadcastJobs) delivers in resumable batches of ≤800/tick,
    // idempotent per recipient — so a large audience never blocks a single
    // invocation or exceeds the Worker subrequest limit, and a retry never
    // double-sends. The raw message is stored; escaping happens once in the
    // drainer (escapeHtml on send), so it must NOT be pre-escaped here.
    const now = Date.now();
    const countRow = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM bot_users bu
         WHERE bu.active = 1
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)`
    ).first() as any;
    const total = Number(countRow?.n || 0);
    const res = await env.DB.prepare(
        `INSERT INTO broadcast_jobs (message, segment, status, created_by, created_at, total_recipients)
         VALUES (?, 'all', 'pending', ?, ?, ?)`
    ).bind(body, from.id, now, total).run();
    const jobId = Number((res as any)?.meta?.last_row_id || 0);
    await sendMessage(
        env,
        chatId,
        `✅ Рассылка поставлена в очередь (задача #${jobId}).\n\nПолучателей: ~${total}\nОтправка идёт батчами каждые 2 минуты. Прогресс виден в админ-панели.`,
        undefined,
        undefined
    );
}
async function handlePredictionsOpenResend(env: Env, msg: any, from: any, chatId: number): Promise<void> {
    if (!isPrivateAdminCommand(env, from, msg)) return;
    if (!isUserNotificationsEnabled(env)) {
        await sendMessage(env, chatId, '⚠️ Массовые уведомления отключены: USER_NOTIFICATIONS_ENABLED=false.');
        return;
    }
    const raw = extractCommandPayload(String(msg?.text || ''), '/predictions_open_resend');
    const day = raw || todayMoscow();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        await sendMessage(env, chatId, 'Используйте формат:\n/predictions_open_resend\nили\n/predictions_open_resend 2026-04-05');
        return;
    }
    const stats = await sendPredictionsOpen(env, day, true);
    if (stats.noMatches) {
        await sendMessage(env, chatId, `ℹ️ Для ${day} нет выбранных матчей или все матчи уже закрыты.`);
        return;
    }
    await sendMessage(
        env,
        chatId,
        `✅ Повторная рассылка «Приём прогнозов открыт» завершена.\n\n` +
        `Дата: ${day}\n` +
        `Отправлено: ${stats.sent}\n` +
        `Пропущено: ${stats.skipped}\n` +
        `Ошибки: ${stats.errors}`
    );
}
async function handlePartnerTaskStart(env: Env, from: any, chatId: number, text: string) {
    await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
    const payload = text.replace('/start partner_', '').trim();
    const sep = payload.indexOf('_');
    const claimIdRaw = sep >= 0 ? payload.slice(0, sep) : '';
    const verifyToken = sep >= 0 ? payload.slice(sep + 1).trim() : '';
    const claimId = Number(claimIdRaw || 0);
    if (!claimId || !verifyToken) {
        await sendMessage(env, chatId, '❌ Ссылка задания некорректна. Открой задание через приложение.');
        return;
    }
    try {
        const claim = await env.DB.prepare(`
            SELECT pc.id as claim_id, pc.campaign_id, pc.user_id, pc.verify_token, pc.status, c.title, c.sponsor_name
            FROM partner_claims pc
            JOIN partner_campaigns c ON c.id = pc.campaign_id
            WHERE pc.id = ? AND pc.verify_token = ?
            LIMIT 1
        `).bind(claimId, verifyToken).first() as any;
        if (!claim) {
            await sendMessage(env, chatId, '❌ Ссылка задания недействительна. Открой задание через приложение.');
            return;
        }
        if (Number(claim.user_id) !== Number(from.id)) {
            await sendMessage(env, chatId, '❌ Ссылка предназначена для другого пользователя.');
            return;
        }
        await env.DB.prepare(`
            INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, 'partner_task_verified', ?, ?)
        `).bind(
            Number(claim.campaign_id),
            Number(from.id),
            Number(claim.claim_id),
            JSON.stringify({ source: 'telegram_bot_start', chatId }),
            Date.now()
        ).run();
        const titleLine = claim.title ? `«${escapeHtml(claim.title)}»\n\n` : '';
        await sendMessage(
            env,
            chatId,
            `✅ Задание партнёра подтверждено.\n\n${titleLine}Вернись в приложение, чтобы завершить проверку и получить награду.`,
            {
                inline_keyboard: [
                    [miniAppInlineUrlButton(env, '📋 Открыть задания', 'tasks')]
                ]
            }
        );
    } catch (e: any) {
        console.error('handlePartnerTaskStart error:', e);
        await sendMessage(env, chatId, '❌ Не удалось подтвердить задание. Попробуй позже или открой его в приложении.');
    }
}
// The bind reply keyboard: channel picker + cancel. Rebuilt on demand because
// one_time_keyboard hides it after a tap — a recoverable failure (channel already
// taken, unreadable chat) must re-offer it, otherwise the user is left with no way
// to pick another channel and no way to cancel, and the bind sits 'pending' until
// it expires 15 minutes later.
function buildBindReplyKeyboard() {
    return {
        keyboard: [[
            {
                text: 'Выбрать канал',
                request_chat: {
                    request_id: 1,
                    chat_is_channel: true,
                    request_title: true,
                    request_username: true,
                    request_photo: true,
                    user_administrator_rights: {
                        can_manage_chat: true,
                        can_post_messages: true
                    },
                    bot_administrator_rights: undefined,
                    bot_is_member: false
                }
            }
        ], [
            { text: BIND_CANCEL_BUTTON }
        ]],
        resize_keyboard: true,
        one_time_keyboard: true
    };
}
// Cancel an in-flight channel bind from the bot side. No voucher is refunded here
// because extra_league_slots is only deducted on successful league creation
// (api-worker POST /leagues) — an aborted bind costs the user nothing.
async function handleBindCancel(env: Env, from: any, chatId: number): Promise<void> {
    await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
    let cancelled = false;
    try {
        const res = await env.DB.prepare(
            `UPDATE pending_channel_binds SET status = 'cancelled' WHERE telegram_user_id = ? AND status = 'pending'`
        ).bind(from.id).run();
        cancelled = Number(res?.meta?.changes || 0) > 0;
    } catch (e: any) {
        console.error('handleBindCancel error:', e);
    }
    // Sending the main keyboard also drops the request_chat keyboard.
    await sendMessage(
        env,
        chatId,
        cancelled
            ? '✅ Привязка канала отменена. Ваучер доп. лиги не списан — лига не создана.'
            : 'ℹ️ Активной привязки канала нет.',
        buildMainReplyKeyboard(env)
    );
}
async function handleChatShared(env: Env, msg: any): Promise<void> {
    const chatId = Number(msg?.chat?.id || 0);
    const from = msg?.from;
    const chatShared = msg?.chat_shared;
    if (!chatId || !from || !chatShared) return;
    await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
    try {
        const bind = await env.DB.prepare(`
            SELECT * FROM pending_channel_binds
            WHERE telegram_user_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
        `).bind(from.id).first() as any;
        // Terminal failures (no session / expired) end the flow: drop the bind keyboard
        // and hand the main menu back.
        if (!bind) {
            await sendMessage(env, chatId, '❌ Активная привязка канала не найдена. Повтори привязку через приложение.', buildMainReplyKeyboard(env));
            return;
        }
        if (Number(bind.expires_at || 0) < Date.now()) {
            await env.DB.prepare(`UPDATE pending_channel_binds SET status = 'expired' WHERE id = ?`).bind(bind.id).run();
            await sendMessage(env, chatId, '❌ Срок действия привязки истёк. Повтори привязку через приложение.', buildMainReplyKeyboard(env));
            return;
        }
        const sharedChatId = Number(chatShared.chat_id || 0);
        const sharedChatTitle = chatShared.title ? String(chatShared.title) : null;
        const sharedChatUsername = chatShared.username ? String(chatShared.username) : null;
        // Recoverable: the bind stays 'pending' and the keyboard comes back, so another
        // channel can be picked without restarting from the app.
        if (!sharedChatId) {
            await sendMessage(env, chatId, '❌ Не удалось получить канал. Выбери другой или отмени привязку.', buildBindReplyKeyboard());
            return;
        }
        const existingLeague = await env.DB.prepare(`
            SELECT id
            FROM leagues
            WHERE telegram_chat_id = ? AND type = 'channel' AND (deleted_at IS NULL OR deleted_at = '')
            LIMIT 1
        `).bind(sharedChatId).first();
        if (existingLeague) {
            await sendMessage(
                env,
                chatId,
                '❌ Этот канал уже привязан к лиге.\n\nВыбери другой канал или нажми «' + BIND_CANCEL_BUTTON + '».',
                buildBindReplyKeyboard()
            );
            return;
        }
        let photoFileId: string | null = null;
        if (Array.isArray(chatShared.photo) && chatShared.photo.length > 0) {
            const bestPhoto = chatShared.photo.reduce((prev: any, current: any) =>
                Number(prev?.file_size || 0) > Number(current?.file_size || 0) ? prev : current
            );
            photoFileId = bestPhoto?.file_id ? String(bestPhoto.file_id) : null;
        }
        await env.DB.prepare(`
            UPDATE pending_channel_binds
            SET status = 'completed', selected_chat_id = ?, selected_chat_title = ?, selected_chat_username = ?, selected_chat_photo_url = ?, completed_at = ?
            WHERE id = ?
        `).bind(sharedChatId, sharedChatTitle, sharedChatUsername, photoFileId, Date.now(), bind.id).run();
        const channelName = sharedChatTitle || sharedChatUsername || String(sharedChatId);
        await clearKeyboard(env, chatId);
        await sendMessage(
            env,
            chatId,
            `✅ Канал <b>${escapeHtml(channelName)}</b> привязан!\n\nВернись в приложение, чтобы завершить создание лиги.`,
            {
                inline_keyboard: [
                    [miniAppInlineUrlButton(env, '⚽ Открыть', 'matches')]
                ]
            }
        );
    } catch (e: any) {
        console.error('handleChatShared error:', e);
        await sendMessage(env, chatId, '❌ Не удалось привязать канал. Попробуй ещё раз или отмени привязку.', buildBindReplyKeyboard());
    }
}
async function handleCallback(env: Env, cb: any): Promise<void> {
    const data = cb.data as string | undefined;
    const from = cb.from;
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;
    let answered = false;
    const safeAnswer = async (text?: string) => {
        if (answered) return;
        answered = true;
        try {
            await answerCallbackQuery(env, cb.id, text);
        } catch (e) {
            console.error('answerCallbackQuery failed:', e);
        }
    };
    try {
        if (!from || !data) {
            await safeAnswer();
            return;
        }
        // [A] Base per-user callback throttle (admins exempt). Over the limit we
        // still answer the query so the client button stops spinning, then stop.
        if (!isAdmin(env, Number(from.id)) && await isRateLimited(RL_CALLBACK.bucket, from.id, RL_CALLBACK.limit, RL_CALLBACK.windowMs)) {
            await safeAnswer();
            return;
        }
        if (chatId) {
            await upsertBotUser(env, from.id, chatId, from.username, from.first_name);
        }
        if (data === 'OPEN_MENU') {
            if (chatId) await handleMenuCommand(env, chatId);
            await safeAnswer();
            return;
        }
        if (data === 'OPEN_SETTINGS') {
            if (chatId && messageId) {
                try {
                    await sendOrEditSettingsMenu(env, chatId, from.id, messageId);
                } catch {
                    await sendOrEditSettingsMenu(env, chatId, from.id);
                }
            } else if (chatId) {
                await sendOrEditSettingsMenu(env, chatId, from.id);
            }
            await safeAnswer('Открываю настройки');
            return;
        }
        // Mode change: mode:OFF, mode:T15, etc.
        if (data.startsWith('mode:')) {
            const newMode = data.replace('mode:', '') as ReminderMode;
            if (!VALID_MODES.includes(newMode)) {
                await safeAnswer('Неизвестный режим');
                return;
            }
            // Ensure row exists before update
            await getOrCreateSettings(env, from.id);
            const now = Date.now();
            const enabled = newMode === 'OFF' ? 0 : 1;
            try {
                await env.DB.prepare(
                    `UPDATE reminder_settings SET enabled = ?, mode = ?, updated_at = ? WHERE user_id = ?`
                ).bind(enabled, newMode, now, from.id).run();
            } catch {
                // Compatibility for schemas without "enabled" column.
                await env.DB.prepare(
                    `UPDATE reminder_settings SET mode = ?, updated_at = ? WHERE user_id = ?`
                ).bind(newMode, now, from.id).run();
            }
            // Update the same message in place
            if (chatId && messageId) {
                try {
                    await sendOrEditSettingsMenu(env, chatId, from.id, messageId);
                } catch {
                    await sendOrEditSettingsMenu(env, chatId, from.id);
                }
            }
            const labels: Record<string, string> = {
                OFF: 'Выкл',
                T15: '15 мин',
                T60_T15: '60+15',
                T60_T15_T3: '60+15+3',
            };
            await safeAnswer(`Режим: ${labels[newMode] || newMode}`);
            return;
        }
        // Opt-out toggles: daily summary / matchday announcement.
        if (data === 'toggle:summary' || data === 'toggle:po') {
            const settings = await getOrCreateSettings(env, from.id);
            const now = Date.now();
            if (data === 'toggle:summary') {
                const next = Number(settings.summary_enabled) !== 0 ? 0 : 1;
                await env.DB.prepare(
                    `UPDATE reminder_settings SET summary_enabled = ?, updated_at = ? WHERE user_id = ?`
                ).bind(next, now, from.id).run();
                await safeAnswer(next ? 'Итоги дня включены' : 'Итоги дня выключены');
            } else {
                const next = Number(settings.predictions_open_enabled) !== 0 ? 0 : 1;
                try {
                    await env.DB.prepare(
                        `UPDATE reminder_settings SET predictions_open_enabled = ?, updated_at = ? WHERE user_id = ?`
                    ).bind(next, now, from.id).run();
                    await safeAnswer(next ? 'Анонс матчей включён' : 'Анонс матчей выключен');
                } catch {
                    // Column not migrated yet (0129) — keep the menu working.
                    await safeAnswer('Настройка пока недоступна, попробуй позже');
                    return;
                }
            }
            if (chatId && messageId) {
                try {
                    await sendOrEditSettingsMenu(env, chatId, from.id, messageId);
                } catch {
                    await sendOrEditSettingsMenu(env, chatId, from.id);
                }
            } else if (chatId) {
                await sendOrEditSettingsMenu(env, chatId, from.id);
            }
            return;
        }
        await safeAnswer();
    } catch (e) {
        console.error('Callback handler error:', e);
        await safeAnswer('Ошибка');
    }
}
// ============================================================
// DB helpers
// ============================================================
// Персональная кнопка меню «Открыть» (с chat_id) — она же признак того, что
// человек прошёл согласие: глобальной кнопки у бота нет намеренно, чтобы в
// приложение нельзя было войти, не дав боту права писать. Ставится и из /start,
// и из enable-pm, потому что пришедший по ссылке-приглашению /start не набирает.
// Сбой кнопки не должен ронять сам вызов — она косметика поверх bot_users.
async function setPersonalMenuButton(env: Env, chatId: number): Promise<void> {
    try {
        await tgApi(env.BOT_TOKEN, 'setChatMenuButton', {
            chat_id: chatId,
            menu_button: {
                type: 'web_app',
                text: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c',
                web_app: { url: miniAppMatchesUrl(env.MINIAPP_URL) }
            }
        });
    } catch { /* кнопка не критична: bot_users уже заведён */ }
}
async function upsertBotUser(
    env: Env,
    userId: number,
    chatId: number,
    username?: string,
    firstName?: string
): Promise<void> {
    await env.DB.prepare(`
    INSERT INTO bot_users (user_id, chat_id, username, first_name, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      username = excluded.username,
      first_name = excluded.first_name,
      active = 1
  `).bind(userId, chatId, username || null, firstName || null, Date.now()).run();
}
type UserSettings = { mode: string; quiet_start: number; quiet_end: number; summary_enabled: number; predictions_open_enabled: number };
async function getOrCreateSettings(env: Env, userId: number): Promise<UserSettings> {
    // predictions_open_enabled arrives with migration 0129 — fall back to the old
    // column list (default 1) if the bot is deployed before the migration is applied.
    let row: any = null;
    try {
        row = await env.DB.prepare(
            'SELECT mode, quiet_start, quiet_end, summary_enabled, predictions_open_enabled FROM reminder_settings WHERE user_id = ?'
        ).bind(userId).first();
    } catch {
        row = await env.DB.prepare(
            'SELECT mode, quiet_start, quiet_end, summary_enabled FROM reminder_settings WHERE user_id = ?'
        ).bind(userId).first();
        if (row) row = { ...row, predictions_open_enabled: 1 };
    }
    if (row) return row as UserSettings;
    const now = Date.now();
    await env.DB.prepare(
        `INSERT OR IGNORE INTO reminder_settings (user_id, mode, quiet_start, quiet_end, summary_enabled, updated_at) VALUES (?, 'T15', 0, 0, 1, ?)`
    ).bind(userId, now).run();
    return { mode: 'T15', quiet_start: 0, quiet_end: 0, summary_enabled: 1, predictions_open_enabled: 1 };
}
async function wasAlreadySent(env: Env, userId: number, reminderType: string, key: string): Promise<boolean> {
    const row = await env.DB.prepare(
        'SELECT 1 FROM reminder_log WHERE user_id = ? AND reminder_type = ? AND reminder_key = ?'
    ).bind(userId, reminderType, key).first();
    return !!row;
}
async function logSent(env: Env, userId: number, day: string, reminderType: string, key: string, messageId?: number): Promise<void> {
    await env.DB.prepare(
        `INSERT OR IGNORE INTO reminder_log (user_id, day, reminder_type, reminder_key, sent_at, message_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(userId, day, reminderType, key, Date.now(), messageId || null).run();
}
// ============================================================
// Cron: Reminders
// ============================================================
type TopMatch = {
    match_id: string;
    home: string;
    away: string;
    lock_time: string;
    start_time: string;
    status: string;
    pos?: number;
};
async function getTopMatchesForDay(env: Env, day: string): Promise<TopMatch[]> {
    // Keep featured_matches in sync with manual override if it exists.
    try {
        const override = await env.DB.prepare(
            `SELECT mode, match_ids_json FROM top3_overrides WHERE day = ?`
        ).bind(day).first() as any;
        if (override?.mode === 'REST') {
            await env.DB.prepare(`DELETE FROM featured_matches WHERE day = ?`).bind(day).run();
            return [];
        }
        if (override?.mode === 'MANUAL') {
            let manualIds: string[] = [];
            try {
                const raw = override.match_ids_json ? JSON.parse(override.match_ids_json as string) : [];
                if (Array.isArray(raw)) manualIds = raw.map((x: any) => String(x));
            } catch {
                manualIds = [];
            }
            await env.DB.prepare(`DELETE FROM featured_matches WHERE day = ?`).bind(day).run();
            for (let i = 0; i < manualIds.length; i++) {
                await env.DB.prepare(`
                    INSERT OR REPLACE INTO featured_matches (day, match_id, pos, source, updated_at)
                    VALUES (?, ?, ?, 'MANUAL', ?)
                `).bind(day, manualIds[i], i + 1, Date.now()).run();
            }
        }
    } catch (e) {
        console.warn('top3_overrides sync skipped', e);
    }
    try {
        const res = await env.DB.prepare(`
            SELECT m.match_id, m.home, m.away, m.lock_time, m.start_time, m.status, fm.pos
            FROM featured_matches fm
            JOIN matches m ON m.day = fm.day AND m.match_id = fm.match_id
            WHERE fm.day = ?
            ORDER BY fm.pos ASC, m.start_time ASC
            LIMIT 3
        `).bind(day).all();
        const rows = (res.results || []) as TopMatch[];
        if (rows.length > 0) return rows;
    } catch (e) {
        console.warn('featured_matches lookup failed', e);
    }
    // Fallback for AUTO selected matches (when top3_overrides is empty or missing)
    try {
        const res = await env.DB.prepare(`
            SELECT match_id, home, away, lock_time, start_time, status
            FROM matches
            WHERE day = ? AND is_pick = 1
            ORDER BY start_time ASC
            LIMIT 3
        `).bind(day).all();
        const rows = (res.results || []) as TopMatch[];
        if (rows.length > 0) return rows;
    } catch (e) {
        console.warn('is_pick fallback failed', e);
    }
    return [];
}
// ============================================================
// Cron cost helpers: daily "already broadcast" gate + interval throttle.
// Both use the runtime Cache API (caches.default) — no binding, no D1, no
// migration. They are COST optimizations only, never correctness anchors:
// every path is fail-open (a cache miss/error falls through to a normal pass)
// and duplicate delivery is still prevented by reminder_log dedup. The gate
// short-circuits the expensive full `bot_users` scan once a day's broadcast is
// fully delivered; the throttle limits how often we re-scan before that.
// ============================================================
function getRuntimeCache(): Cache | undefined {
    try { return (globalThis as any).caches?.default as Cache | undefined; }
    catch { return undefined; }
}
async function dailyGateHit(kind: string, day: string): Promise<boolean> {
    try {
        const cache = getRuntimeCache();
        if (!cache) return false;
        return !!(await cache.match(`https://gate.scoregame.local/${kind}/${day}`));
    } catch { return false; }
}
async function markDailyGate(kind: string, day: string): Promise<void> {
    try {
        const cache = getRuntimeCache();
        if (!cache) return;
        await cache.put(
            `https://gate.scoregame.local/${kind}/${day}`,
            new Response('1', { headers: { 'Cache-Control': 'max-age=86400' } })
        );
    } catch { /* fail-open */ }
}
/** True ⇒ within the interval, caller should skip this tick. Fail-open (false). */
async function withinCronThrottle(key: string, intervalMinutes: number): Promise<boolean> {
    try {
        const cache = getRuntimeCache();
        if (!cache) return false;
        const url = `https://throttle.scoregame.local/${key}`;
        if (await cache.match(url)) return true;
        const ttl = Math.max(60, intervalMinutes * 60);
        await cache.put(url, new Response('1', { headers: { 'Cache-Control': `max-age=${ttl}` } }));
        return false;
    } catch { return false; }
}
// ============================================================
// Per-user inbound rate limiting (best-effort, Cache API only).
// The webhook is already behind Telegram's secret_token, so the threat is not
// anonymous flooding but a legitimate user spamming updates — each touches D1
// (upsertBotUser) and Telegram. Fixed-window counter keyed by window start; it
// is per-edge-colo and non-atomic, so approximate by design. fail-open: any
// cache error returns "not limited" so a hiccup never drops real traffic.
// Payment updates are intentionally never rate limited.
// ============================================================
const RL_MSG = { bucket: 'msg', limit: 25, windowMs: 60_000 };       // A: any inbound message
const RL_CALLBACK = { bucket: 'cb', limit: 30, windowMs: 60_000 };   // A: inline-button callbacks
const RL_VERIFY = { bucket: 'verify', limit: 5, windowMs: 60_000 };  // B: partner/bind deep links
async function isRateLimited(
    bucket: string,
    subject: string | number,
    limit: number,
    windowMs: number
): Promise<boolean> {
    try {
        const cache = getRuntimeCache();
        if (!cache) return false;
        const windowStart = Math.floor(Date.now() / windowMs);
        const key = `https://ratelimit.scoregame.local/${bucket}/${subject}/${windowStart}`;
        const hit = await cache.match(key);
        const count = hit ? (Number(await hit.text()) || 0) : 0;
        if (count >= limit) return true;
        const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
        await cache.put(key, new Response(String(count + 1), { headers: { 'Cache-Control': `max-age=${ttlSec}` } }));
        return false;
    } catch {
        return false; // fail-open
    }
}
/**
 * Batch-load all reminder_log keys for a day into an in-memory Set, replacing the
 * per-user `wasAlreadySent` query (N+1) on the hot cron path. Goes through the
 * idx_reminder_log_day index. Membership key: `${user_id}:${reminder_type}:${reminder_key}`.
 */
async function loadSentKeysForDay(env: Env, day: string): Promise<Set<string>> {
    const set = new Set<string>();
    try {
        const res = await env.DB.prepare(
            `SELECT user_id, reminder_type, reminder_key FROM reminder_log WHERE day = ?`
        ).bind(day).all();
        for (const r of (res.results || []) as any[]) {
            set.add(`${r.user_id}:${r.reminder_type}:${r.reminder_key}`);
        }
    } catch (e) {
        console.warn('loadSentKeysForDay failed, falling back to per-user dedup', e);
    }
    return set;
}
// ============================================================
// Cron: Predictions Open Notification
// ============================================================
async function sendPredictionsOpen(
    env: Env,
    day: string,
    forceResend: boolean = false
): Promise<{ sent: number; skipped: number; errors: number; noMatches?: boolean }> {
    const matches = await getTopMatchesForDay(env, day);
    if (matches.length === 0) return { sent: 0, skipped: 0, errors: 0, noMatches: true };
    // Only send if matches haven't all started yet
    const nowMs = Date.now();
    const hasUpcoming = matches.some((m: any) => {
        const lockMs = new Date(m.lock_time).getTime();
        return Number.isFinite(lockMs) && lockMs > nowMs;
    });
    if (!hasUpcoming) return { sent: 0, skipped: 0, errors: 0, noMatches: true };
    // All active users minus banned and minus those who toggled the announcement off
    // (reminder mode OFF deliberately does NOT silence this — it has its own
    // predictions_open_enabled toggle in the settings menu).
    let usersRes: any;
    try {
        usersRes = await env.DB.prepare(`
            SELECT bu.user_id, bu.chat_id, bu.first_name
            FROM bot_users bu
            LEFT JOIN reminder_settings rs ON rs.user_id = bu.user_id
            WHERE bu.active = 1
              AND COALESCE(rs.predictions_open_enabled, 1) = 1
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)
        `).all();
    } catch {
        // predictions_open_enabled arrives with migration 0129 — pre-migration fallback.
        usersRes = await env.DB.prepare(`
            SELECT bu.user_id, bu.chat_id, bu.first_name
            FROM bot_users bu
            WHERE bu.active = 1
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)
        `).all();
    }
    const users = (usersRes.results || []) as any[];
    if (users.length === 0) return { sent: 0, skipped: 0, errors: 0 };
    const matchIds = matches.map((m: any) => String(m.match_id));
    const picksPlaceholders = matchIds.map(() => '?').join(',');
    // Format match list with times in MSK
    const matchLines = matches.map((m: any) => {
        const d = new Date(m.start_time);
        const hh = String((d.getUTCHours() + 3) % 24).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        return `⚽ ${escapeHtml(m.home)} — ${escapeHtml(m.away)} (${hh}:${mm} МСК)`;
    }).join('\n');
    const dateLabel = formatDateRu(day);
    // Batch dedup: one indexed read for the whole day instead of one query per user.
    const sentSet = forceResend ? null : await loadSentKeysForDay(env, day);
    let sent = 0, skipped = 0, errors = 0;
    for (const user of users) {
        try {
            // Dedup: already sent for this day?
            if (sentSet && sentSet.has(`${user.user_id}:PREDICTIONS_OPEN:${day}`)) { skipped++; continue; }
            // Check if user already has all picks for today
            const picksRes = await env.DB.prepare(
                `SELECT match_id FROM picks WHERE day = ? AND user_id = ? AND match_id IN (${picksPlaceholders})`
            ).bind(day, user.user_id, ...matchIds).all();
            const pickedCount = (picksRes.results || []).length;
            if (pickedCount >= matches.length) { skipped++; continue; } // All picks made, skip
            const text = `⚽ <b>Приём прогнозов на ${dateLabel} открыт!</b>\n\nСегодня ${pluralMatches(matches.length)} — делай прогнозы сейчас 🎯\n\n${matchLines}\n\n⭐ Загляни в доп. вопросы к матчам: там лежат звёзды. Копи их и меняй на мячи 👊`;
            const safeText = sanitizeOutgoingText(
                text,
                `predictions_open(day=${day}, user=${user.user_id})`,
                `⚽ <b>Приём прогнозов на ${dateLabel} открыт!</b>\n\nМатчи дня уже доступны — заходи и делай прогнозы.`
            );
            const result = await sendMessage(env, user.chat_id, safeText, {
                inline_keyboard: [
                    [miniAppInlineUrlButton(env, '⚽ Делать прогнозы', 'matches')],
                ],
            });
            if (result.ok) {
                sent++;
                if (!forceResend) {
                    await logSent(env, user.user_id, day, 'PREDICTIONS_OPEN', day);
                    sentSet?.add(`${user.user_id}:PREDICTIONS_OPEN:${day}`);
                }
            } else {
                errors++;
            }
            // If blocked, just skip (don't break Р Р†Р вЂљРІР‚Сњ user will be cleaned up later)
        } catch (e) {
            errors++;
            console.error(`[PREDICTIONS_OPEN] Error for user ${user.user_id}:`, e);
        }
    }
    return { sent, skipped, errors };
}
async function cronPredictionsOpen(env: Env): Promise<void> {
    if (!isUserNotificationsEnabled(env)) return;
    const day = todayMoscow();
    // Cost gate: once the day's "predictions open" broadcast is fully delivered,
    // skip the full bot_users scan on every subsequent tick.
    if (await dailyGateHit('predictions_open', day)) return;
    // Before the gate is set (during the active broadcast window) re-scan at most
    // every 10 min instead of every 2 — this notification is not time-critical.
    if (await withinCronThrottle('predictions_open', 10)) return;
    const stats = await sendPredictionsOpen(env, day, false);
    // A pass that matched real featured matches yet made no new sends and hit no
    // errors ⇒ everyone reachable is already covered ⇒ close the gate for the day.
    // noMatches is left ungated: matches may still appear later in the day.
    if (!stats.noMatches && stats.sent === 0 && stats.errors === 0) {
        await markDailyGate('predictions_open', day);
    }
}
async function cronReminders(env: Env): Promise<void> {
    if (!isUserNotificationsEnabled(env)) return;
    const day = todayMoscow();
    const nowMs = Date.now();
    const matches = await getTopMatchesForDay(env, day);
    if (matches.length === 0) return;
    const usersRes = await env.DB.prepare(`
    SELECT bu.user_id, bu.chat_id, bu.first_name,
           rs.mode
    FROM bot_users bu
    JOIN reminder_settings rs ON rs.user_id = bu.user_id
    WHERE bu.active = 1 AND rs.mode != 'OFF'
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)
  `).all();
    const users = (usersRes.results || []) as any[];
    if (users.length === 0) return;
    const totalMatches = matches.length;
    const matchIds = matches.map((m: any) => String(m.match_id));
    const picksPlaceholders = matchIds.map(() => '?').join(',');
    // Prepare all matches with lock times
    const allWithLock = matches
        .map((m: any) => ({ ...m, lockMs: new Date(m.lock_time).getTime() }))
        .filter((m: any) => Number.isFinite(m.lockMs) && m.lockMs > nowMs)
        .sort((a: any, b: any) => a.lockMs - b.lockMs);
    if (allWithLock.length === 0) return;

    // Smart-cron phase 2 (pre-gate): only the T60/T15/T3 windows can produce a
    // reminder. If no featured match is currently inside any reminder window, the
    // per-user loop below would send nothing — skip it (and its picks reads)
    // entirely. This eliminates the per-user query storm during the long stretch
    // between predictions opening and the first imminent lock.
    const anyWindowActive = allWithLock.some((m: any) => activeReminderWindows(m.lockMs, nowMs).length > 0);
    if (!anyWindowActive) return;

    // Smart-cron phase 2 (batch): fetch picks for ALL featured matches once and
    // group by user, instead of one SELECT per user (N+1). match_id IN (...) keeps
    // the bound-parameter count tiny (few featured matches) regardless of user count.
    const allPicksRes = await env.DB.prepare(
        `SELECT user_id, match_id, joker FROM picks WHERE day = ? AND match_id IN (${picksPlaceholders})`
    ).bind(day, ...matchIds).all();
    const picksByUser = new Map<string, any[]>();
    for (const p of (allPicksRes.results || []) as any[]) {
        const k = String(p.user_id);
        const list = picksByUser.get(k);
        if (list) list.push(p);
        else picksByUser.set(k, [p]);
    }

    // Batch dedup: one indexed read of the day's reminder_log instead of a query
    // per user per window (the N+1 that dominated D1 reads on the 2-min cron).
    const sentSet = await loadSentKeysForDay(env, day);

    for (const user of users) {
        try {
            const userPicks = picksByUser.get(String(user.user_id)) || [];
            const pickedMatchIds = new Set(userPicks.map((p: any) => String(p.match_id)));
            const hasJoker = userPicks.some((p: any) => Number(p.joker) === 1);
            // --- Per-match deadline reminders ---
            // For each window type, collect matches with NEAR deadline that user hasn't picked
            const windowMatchMap: Record<string, any[]> = {};
            for (const m of allWithLock) {
                const isPicked = pickedMatchIds.has(String(m.match_id));
                if (isPicked) continue; // Skip picked matches
                const windows = activeReminderWindows(m.lockMs, nowMs);
                for (const w of windows) {
                    if (!windowMatchMap[w]) windowMatchMap[w] = [];
                    windowMatchMap[w].push(m);
                }
            }
            // Send one message per window with only near-deadline, unpicked matches
            let userBlocked = false;
            for (const window of ['T60', 'T15', 'T3']) {
                if (userBlocked) break;
                const nearMatches = windowMatchMap[window];
                if (!nearMatches || nearMatches.length === 0) continue;
                if (!modeIncludes(user.mode, window)) continue;
                // Dedup key based on the specific set of match IDs in this window
                const matchIdsSorted = nearMatches.map((m: any) => m.match_id).sort().join('_');
                const reminderKey = `${day}:${matchIdsSorted}`;
                if (sentSet.has(`${user.user_id}:${window}:${reminderKey}`)) continue;
                const minuteLabel = windowMinutes(window);
                const matchLines = nearMatches.map((m: any) => {
                    const lockDate = new Date(m.lock_time);
                    const hh = String((lockDate.getUTCHours() + 3) % 24).padStart(2, '0'); // MSK
                    const mm = String(lockDate.getUTCMinutes()).padStart(2, '0');
                    return `⚽ ${escapeHtml(m.home)} — ${escapeHtml(m.away)} (${hh}:${mm} МСК)`;
                }).join('\n');
                const text = `⏰ <b>До закрытия прогнозов ${minuteLabel}!</b>\n\nУспей сделать прогнозы\n\n${matchLines}`;
                const result = await sendMessage(env, user.chat_id, text, {
                    inline_keyboard: [
                        [miniAppInlineUrlButton(env, '⚽ Открыть матчи', 'matches')],
                        [{ text: '⚙️ Настройки', callback_data: 'OPEN_SETTINGS' }],
                    ],
                });
                if (result.ok) {
                    await logSent(env, user.user_id, day, window, reminderKey);
                    sentSet.add(`${user.user_id}:${window}:${reminderKey}`);
                }
                if (result.blocked) { userBlocked = true; break; }
            }
            // --- Joker reminder ---
            if (!userBlocked && !hasJoker && pickedMatchIds.size > 0) {
                // Send at most one joker reminder per window (not per match)
                let jokerSent = false;
                for (const window of ['T60', 'T15', 'T3']) {
                    if (jokerSent || userBlocked) break;
                    if (!modeIncludes(user.mode, window)) continue;
                    // Check if any unpicked match is in this window
                    const hasNearMatch = allWithLock.some((m: any) =>
                        activeReminderWindows(m.lockMs, nowMs).includes(window)
                    );
                    if (!hasNearMatch) continue;
                    const jokerType = `JOKER_${window}`;
                    const jokerKey = `${day}:${window}`;
                    if (sentSet.has(`${user.user_id}:${jokerType}:${jokerKey}`)) continue;
                    const minuteLabel = windowMinutes(window);
                    const text = `🃏 <b>Ещё не поставлен джокер!</b>\n\nДо блокировки ${minuteLabel}. Прогнозы есть, а джокер (x2) — нет.`;
                    const result = await sendMessage(env, user.chat_id, text, {
                        inline_keyboard: [
                            [miniAppInlineUrlButton(env, '⚽ Открыть матчи', 'matches')],
                            [{ text: '⚙️ Настройки', callback_data: 'OPEN_SETTINGS' }],
                        ],
                    });
                    if (result.ok) {
                        await logSent(env, user.user_id, day, jokerType, jokerKey);
                        sentSet.add(`${user.user_id}:${jokerType}:${jokerKey}`);
                        jokerSent = true;
                    }
                    if (result.blocked) { userBlocked = true; }
                }
            }
        } catch (e) {
            console.error(`Error processing user ${user.user_id}:`, e);
        }
    }
}
/** Check whether a user's mode includes a given window */
function modeIncludes(mode: string, window: string): boolean {
    switch (mode) {
        case 'T15':
            return window === 'T15';
        case 'T60_T15':
            return window === 'T60' || window === 'T15';
        case 'T60_T15_T3':
            return window === 'T60' || window === 'T15' || window === 'T3';
        default:
            return false;
    }
}
/** Human-readable time remaining */
function windowMinutes(window: string): string {
    switch (window) {
        case 'T3': return '3 часа';
        case 'T60': return '60 минут';
        case 'T15': return '15 минут';
        default: return window;
    }
}
// ============================================================
// Daily Summary
// ============================================================
function formatDateRuShort(dayStr: string): string {
    const d = new Date(dayStr + 'T12:00:00Z');
    return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Europe/Moscow',
    }).format(d).replace('.', '');
}
// Mirrors api-worker isFinishedMatchStatus (FINISHED/FT/FULL_TIME, plus AWARDED which
// api normalizes to FINISHED); FINISHED_AET/FINISHED_PEN kept for legacy rows.
function isMatchFinishedStatus(status: string | null | undefined): boolean {
    const s = String(status || '').toUpperCase();
    return s === 'FT' || s === 'FINISHED' || s === 'FULL_TIME' || s === 'AWARDED'
        || s === 'FINISHED_AET' || s === 'FINISHED_PEN';
}
/**
 * True when `results` holds a row for every featured match of the day — i.e. the
 * app already shows the day's scores. Mirrors what the Mini App reads, so the
 * summary can never precede the published result. Fails closed on a DB error:
 * a later cron tick retries, and no summary is worse than a wrong one.
 */
async function allResultsPublished(env: Env, day: string, matchIds: string[]): Promise<boolean> {
    if (matchIds.length === 0) return false;
    try {
        const placeholders = matchIds.map(() => '?').join(',');
        const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM results WHERE day = ? AND match_id IN (${placeholders})`
        ).bind(day, ...matchIds).first() as any;
        return Number(row?.n || 0) >= matchIds.length;
    } catch (e) {
        console.warn(`[SUMMARY] results check failed for day=${day}`, e);
        return false;
    }
}
async function findFinishedFeaturedMatchday(env: Env): Promise<{ day: string; matches: TopMatch[] } | null> {
    const today = todayMoscow();
    const candidateSet = new Set<string>();
    // 1) Days from featured_matches table (admin-configured)
    try {
        const daysRes = await env.DB.prepare(`
            SELECT DISTINCT day
            FROM featured_matches
            WHERE day <= ?
            ORDER BY day DESC
            LIMIT 7
        `).bind(today).all();
        for (const r of (daysRes.results || []) as any[]) {
            candidateSet.add(String(r.day));
        }
    } catch { }
    // 2) Days from auto-selected matches (is_pick=1)
    try {
        const autoRes = await env.DB.prepare(`
            SELECT DISTINCT day
            FROM matches
            WHERE is_pick = 1 AND day <= ?
            ORDER BY day DESC
            LIMIT 7
        `).bind(today).all();
        for (const r of (autoRes.results || []) as any[]) {
            candidateSet.add(String(r.day));
        }
    } catch { }
    // Always include today
    candidateSet.add(today);
    // Sort descending (most recent first)
    const candidateDays = [...candidateSet].sort((a, b) => b.localeCompare(a));
    console.log(`[SUMMARY] candidateDays=${candidateDays.join(',')}`);
    for (const day of candidateDays) {
        const matches = await getTopMatchesForDay(env, day);
        console.log(`[SUMMARY] day=${day} matches=${matches.length} statuses=${matches.map(m => m.status).join(',')}`);
        // Admin can publish 1-3 matches (MANUAL mode) — summarize any non-empty day.
        if (matches.length === 0) continue;
        if (!matches.every((m) => isMatchFinishedStatus(m.status))) continue;
        // A provider can flip status to FINISHED hours before it confirms the 90-min
        // score, and api-worker only writes `results` once that score is valid. Gating
        // on status alone sent the 2026-07-19 summary 6h before the app published the
        // result. Require a stored result for every match of the day instead.
        if (!await allResultsPublished(env, day, matches.map((m) => String(m.match_id)))) {
            console.log(`[SUMMARY] day=${day} finished by status but results not published yet — waiting`);
            continue;
        }
        return { day, matches };
    }
    console.log('[SUMMARY] No finished matchday found');
    return null;
}
/** Outcome helper: 1 = home win, -1 = away win, 0 = draw */
function outcomeSign(a: number, b: number): number {
    if (a === b) return 0;
    return a > b ? 1 : -1;
}
/** Full scoring logic — mirrors api-worker calculateMatchPoints exactly */
function calculateMatchPointsFull(
    pH: number, pA: number, rH: number, rA: number,
    joker: number, dcVariant: string | null
): { base: number; mult: number; total: number; reason: string } {
    let base = 0; let reason = 'miss';
    if (pH === rH && pA === rA) { base = 5; reason = 'exact'; }
    else if (pH - pA === rH - rA && rH !== rA && pH !== pA) { base = 3; reason = 'diff'; }
    else if (outcomeSign(pH, pA) === outcomeSign(rH, rA)) { base = 2; reason = 'outcome'; }
    const mult = joker === 1 ? 2 : 1;
    let total = base * mult;
    // Double Chance: only fires when base=0 and no joker
    if (base === 0 && dcVariant && mult === 1) {
        const o = outcomeSign(rH, rA);
        let hit = false;
        if (dcVariant === '1X') hit = o === 1 || o === 0;
        if (dcVariant === 'X2') hit = o === 0 || o === -1;
        if (dcVariant === '12') hit = o === 1 || o === -1;
        if (hit) { total = 2; reason = 'double_chance'; }
    }
    return { base, mult, total, reason };
}
async function getUserSummaryPoints(
    env: Env,
    day: string,
    userId: number,
    matchIds: string[]
): Promise<{ total: number; details: any[] }> {
    if (matchIds.length === 0) return { total: 0, details: [] };
    const placeholders = matchIds.map(() => '?').join(',');
    // Match-result points only (5/3/2/0 with joker/double-chance) — bonus questions
    // reward stars in api-worker (2026-06-26) and never count toward day points.
    const picksRes = await env.DB.prepare(
        `SELECT p.match_id, p.home, p.away, p.joker, p.double_chance
         FROM picks p
         WHERE p.day = ? AND p.user_id = ? AND p.match_id IN (${placeholders})`
    ).bind(day, userId, ...matchIds).all();
    const picks = (picksRes.results || []) as any[];
    // Fetch results
    const resultsRes = await env.DB.prepare(
        `SELECT match_id, home, away FROM results WHERE day = ? AND match_id IN (${placeholders})`
    ).bind(day, ...matchIds).all();
    const results = (resultsRes.results || []) as any[];
    const resultsMap = new Map(results.map((r: any) => [String(r.match_id), r]));
    let total = 0;
    const details: any[] = [];
    for (const p of picks) {
        const result = resultsMap.get(String(p.match_id));
        if (!result) continue;
        const res = calculateMatchPointsFull(
            Number(p.home), Number(p.away),
            Number(result.home), Number(result.away),
            Number(p.joker),
            p.double_chance || null
        );
        total += res.total;
        details.push({
            match_id: p.match_id,
            predicted: `${p.home}-${p.away}`,
            actual: `${result.home}-${result.away}`,
            base: res.base,
            boost: p.joker ? 'joker' : (p.double_chance ? `dc:${p.double_chance}` : 'none'),
            points: res.total,
            reason: res.reason,
        });
    }
    return { total, details };
}
/** League type emoji for display */
function leagueTypeEmoji(type: string | null | undefined): string {
    switch (type) {
        case 'channel': return '\uD83D\uDCE3';
        case 'private': return '\uD83D\uDC65';
        case 'global':
        default: return '\uD83C\uDF0D';
    }
}
/**
 * Global day standings — mirrors the app's day leaderboard
 * (user_day_stats aggregate + the same tie-breakers as api-worker
 * leaderboardTieBreak.ts: points → exact → diff → outcome, full tie = shared
 * place). Computed once per summary pass and shared across all recipients
 * instead of one query per user.
 */
async function getGlobalDayRanks(env: Env, day: string): Promise<{ ranks: Map<number, number>; total: number } | null> {
    try {
        const res = await env.DB.prepare(`
            SELECT
              uds.user_id,
              COALESCE(uds.points, 0) AS points,
              COALESCE(uds.exact_count, 0) AS exact_count,
              COALESCE(uds.diff_count, 0) AS diff_count,
              COALESCE(uds.outcome_count, 0) AS outcome_count
            FROM user_day_stats uds
            JOIN users u ON u.id = uds.user_id
            WHERE uds.day = ?
              AND COALESCE(uds.picks_count, 0) > 0
              AND COALESCE(u.is_banned, 0) = 0
        `).bind(day).all();
        const rows = ((res.results || []) as any[]).map((r: any) => ({
            userId: Number(r.user_id),
            points: Number(r.points || 0),
            exactCount: Number(r.exact_count || 0),
            diffCount: Number(r.diff_count || 0),
            outcomeCount: Number(r.outcome_count || 0),
        }));
        if (rows.length === 0) return null;
        const compare = (a: typeof rows[number], b: typeof rows[number]) =>
            b.points - a.points ||
            b.exactCount - a.exactCount ||
            b.diffCount - a.diffCount ||
            b.outcomeCount - a.outcomeCount;
        rows.sort(compare);
        const ranks = new Map<number, number>();
        let prevRank = 0;
        rows.forEach((row, index) => {
            const rank = index > 0 && compare(rows[index - 1], row) === 0 ? prevRank : index + 1;
            ranks.set(row.userId, rank);
            prevRank = rank;
        });
        return { ranks, total: rows.length };
    } catch (e) {
        console.error('[SUMMARY] global day ranks failed:', e);
        return null;
    }
}
/** Get per-league rank lines for all leagues the user belongs to */
async function getAllLeaguePlaceLines(env: Env, userId: number, day: string): Promise<string | null> {
    try {
        const leaguesRes = await env.DB.prepare(`
            SELECT lm.league_id, l.name, l.type, l.deleted_at
            FROM league_members lm
            JOIN leagues l ON l.id = lm.league_id
            WHERE lm.user_id = ?
        `).bind(userId).all();
        const leagues = (leaguesRes.results || []) as any[];
        if (leagues.length === 0) return null;
        const activeLeagues = leagues.filter((l: any) => !l.deleted_at);
        if (activeLeagues.length === 0) return null;
        const lines: string[] = [];
        for (const league of activeLeagues) {
            try {
                const membersRes = await env.DB.prepare(`
                    SELECT
                      lm.user_id,
                      COALESCE(lds.points, 0) AS points,
                      COALESCE(lds.exact_count, 0) AS exact_count,
                      COALESCE(lds.joker_points, 0) AS joker_points,
                      lds.earliest_pick_time
                    FROM league_members lm
                    JOIN users u ON u.id = lm.user_id
                    LEFT JOIN league_day_stats lds
                      ON lds.league_id = lm.league_id
                      AND lds.user_id = lm.user_id
                      AND lds.day = ?
                    WHERE lm.league_id = ?
                      AND COALESCE(u.is_banned, 0) = 0
                    ORDER BY
                      points DESC,
                      exact_count DESC,
                      joker_points DESC,
                      COALESCE(lds.earliest_pick_time, 9223372036854775807) ASC,
                      lm.user_id ASC
                `).bind(day, league.league_id).all();
                const members = (membersRes.results || []) as any[];
                const total = members.length;
                if (total <= 1) continue;
                const rank = members.findIndex((m: any) => Number(m.user_id) === userId) + 1;
                if (rank <= 0) continue;
                const emoji = leagueTypeEmoji(league.type);
                const name = league.name || '\u041B\u0438\u0433\u0430';
                lines.push(`${emoji} ${name} \u2014 ${rank} \u0438\u0437 ${total}`);
            } catch {
            }
        }
        if (lines.length === 0) return null;
        return lines.join('\n');
    } catch {
        return null;
    }
}
async function sendDailySummary(
    env: Env,
    overrideDay?: string,
    isResend: boolean = false,
    replaceExisting: boolean = false
): Promise<{ sent: number; edited: number; deleted: number; skipped: number; noMatches?: boolean }> {
    if (!isUserNotificationsEnabled(env)) {
        console.log('[DAILY_SUMMARY] Skipped — USER_NOTIFICATIONS_ENABLED=false');
        return { sent: 0, edited: 0, deleted: 0, skipped: 0 };
    }
    let matchday;
    if (overrideDay) {
        const matches = await getTopMatchesForDay(env, overrideDay);
        if (matches.length > 0) {
            matchday = { day: overrideDay, matches };
        } else {
            console.log(`[RESEND] No top matches resolved for day=${overrideDay}`);
            return { sent: 0, edited: 0, deleted: 0, skipped: 0, noMatches: true };
        }
    } else {
        matchday = await findFinishedFeaturedMatchday(env);
    }
    if (!matchday) return { sent: 0, edited: 0, deleted: 0, skipped: 0 };
    const { day, matches } = matchday;
    // Cost gate (auto cron pass only): once the day's summary is fully delivered,
    // skip the full bot_users scan on every subsequent tick. Resend/override always
    // runs. fail-open; reminder_log dedup still prevents any duplicate summary.
    const isAutoPass = !overrideDay && !isResend;
    if (isAutoPass && await dailyGateHit('daily_summary', day)) {
        return { sent: 0, edited: 0, deleted: 0, skipped: 0 };
    }
    const matchIds = matches.map((m: any) => String(m.match_id));
    const dateLabel = formatDateRuShort(day);
    const usersRes = await env.DB.prepare(`
        SELECT bu.user_id, bu.chat_id, bu.active, rs.summary_enabled
        FROM bot_users bu
        LEFT JOIN reminder_settings rs ON rs.user_id = bu.user_id
        WHERE bu.active = 1
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)
    `).all();
    const users = (usersRes.results || []) as any[];
    if (users.length === 0) return { sent: 0, edited: 0, deleted: 0, skipped: 0 };
    // Batch dedup for the non-resend pass: one indexed read instead of per-user.
    const sentSet = isResend ? null : await loadSentKeysForDay(env, day);
    const globalDay = await getGlobalDayRanks(env, day);
    let sent = 0, edited = 0, deleted = 0, skipped = 0, failed = 0;
    for (const user of users) {
        try {
            const summaryEnabled = user.summary_enabled === null || user.summary_enabled === undefined ? 1 : Number(user.summary_enabled);
            if (summaryEnabled === 0) { skipped++; continue; }
            const summaryKey = day;
            if (sentSet && sentSet.has(`${user.user_id}:SUMMARY:${summaryKey}`)) { skipped++; continue; }
            const { total: points, details } = await getUserSummaryPoints(env, day, Number(user.user_id), matchIds);
            const pointsLabel = points > 0 ? `+${points}` : `${points}`;
            console.log(`[SUMMARY] user=${user.user_id} day=${day} points=${points} details=${JSON.stringify(details)}`);
            let text = `\uD83D\uDCCA \u0418\u0442\u043E\u0433\u0438 \u0434\u043D\u044F (${dateLabel})\n\n\u041E\u0447\u043A\u0438: ${pointsLabel}`;
            const globalRank = globalDay?.ranks.get(Number(user.user_id));
            if (globalRank && globalDay && globalDay.total > 1) {
                text += `\n\n\uD83C\uDF0D \u041E\u0431\u0449\u0438\u0439 \u0440\u0435\u0439\u0442\u0438\u043D\u0433 \u0437\u0430 \u0434\u0435\u043D\u044C \u2014 ${globalRank} \u0438\u0437 ${globalDay.total}`;
            }
            const leaguePlaces = await getAllLeaguePlaceLines(env, Number(user.user_id), day);
            if (leaguePlaces) {
                text += `\n\n\u041C\u0435\u0441\u0442\u0430 \u0432 \u043B\u0438\u0433\u0430\u0445:\n${leaguePlaces}`;
            }
            const replyMarkup = {
                inline_keyboard: [
                    [miniAppInlineUrlButton(env, '\u26BD \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043C\u0430\u0442\u0447\u0438', 'matches')],
                    [miniAppInlineUrlButton(env, '\uD83C\uDFC6 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0440\u0435\u0439\u0442\u0438\u043D\u0433', 'rating')],
                    [{ text: '\u2699\uFE0F \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438', callback_data: 'OPEN_SETTINGS' }],
                ],
            };
            if (isResend) {
                const oldLog = await env.DB.prepare(`SELECT message_id FROM reminder_log WHERE user_id = ? AND reminder_type = 'SUMMARY' AND reminder_key = ?`).bind(user.user_id, summaryKey).first() as any;
                if (oldLog?.message_id) {
                    if (!replaceExisting) {
                        try {
                            // parseMode undefined — the summary is sent as plain text below;
                            // an HTML edit would fail on league names containing '<'.
                            await editMessageText(env, Number(user.chat_id), oldLog.message_id, text, replyMarkup, undefined);
                            console.log(`[RESEND] Edited message ${oldLog.message_id} for user ${user.user_id}`);
                            edited++;
                            continue;
                        } catch {
                            try {
                                await tgApi(env.BOT_TOKEN, 'deleteMessage', {
                                    chat_id: Number(user.chat_id),
                                    message_id: oldLog.message_id,
                                });
                            } catch { }
                        }
                    } else {
                        let deletedOld = false;
                        try {
                            const deleteRes = await tgApi(env.BOT_TOKEN, 'deleteMessage', {
                                chat_id: Number(user.chat_id),
                                message_id: oldLog.message_id,
                            });
                            if (deleteRes.status === 200) {
                                deleted++;
                                deletedOld = true;
                            } else {
                                console.warn(`[RESEND] Failed to delete old summary ${oldLog.message_id} for user ${user.user_id}: ${deleteRes.status} ${String(deleteRes.body?.description || '')}`);
                            }
                        } catch (deleteError) {
                            console.warn(`[RESEND] Delete old summary error for user ${user.user_id}:`, deleteError);
                        }
                        if (!deletedOld) {
                            try {
                                await editMessageText(env, Number(user.chat_id), oldLog.message_id, text, replyMarkup, undefined);
                                console.log(`[RESEND] Replace fallback edited message ${oldLog.message_id} for user ${user.user_id}`);
                                edited++;
                                continue;
                            } catch (editError) {
                                console.warn(`[RESEND] Replace fallback edit failed for user ${user.user_id}:`, editError);
                            }
                        }
                    }
                }
                await env.DB.prepare(`DELETE FROM reminder_log WHERE user_id = ? AND reminder_type = 'SUMMARY' AND reminder_key = ?`).bind(user.user_id, summaryKey).run();
            }
            const result = await sendMessage(env, Number(user.chat_id), text, replyMarkup, undefined);
            if (result.ok) {
                await logSent(env, Number(user.user_id), day, 'SUMMARY', summaryKey, result.message_id);
                sentSet?.add(`${user.user_id}:SUMMARY:${summaryKey}`);
                sent++;
            } else if (!result.blocked) {
                failed++;
            }
        } catch (e) {
            failed++;
            console.error(`Summary error for user ${user.user_id}:`, e);
        }
    }
    // Close the daily gate only when a pass delivered nothing new AND nothing failed
    // ⇒ every reachable, summary-enabled user is already covered for the day.
    if (isAutoPass && sent === 0 && failed === 0) {
        await markDailyGate('daily_summary', day);
    }
    return { sent, edited, deleted, skipped };
}
// ============================================================
// Cron: Cleanup old reminder_log entries (> 30 days)
// ============================================================
// Cron wrapper: the daily summary is not time-critical, so before its gate is set
// (i.e. right after a day finalizes and we're actively broadcasting) re-scan at most
// every 10 min instead of every 2. Once delivered, dailyGate short-circuits entirely.
async function cronDailySummary(env: Env): Promise<void> {
    if (await withinCronThrottle('daily_summary', 10)) return;
    await sendDailySummary(env);
}
async function cleanupOldLogs(env: Env): Promise<void> {
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const cutoffDay = new Date(cutoffMs).toISOString().slice(0, 10);
    try {
        await env.DB.prepare('DELETE FROM reminder_log WHERE day < ?').bind(cutoffDay).run();
    } catch (e) {
        console.error('Cleanup error:', e);
    }
}
// ============================================================
// Season Notifications
// ============================================================
async function sendSeasonNotification(
    env: Env,
    type: 'SEASON_END' | 'SEASON_START',
    seasonNumber: number
): Promise<{ sent: number; skipped: number; errors: number; blocked: number }> {
    const stats = { sent: 0, skipped: 0, errors: 0, blocked: 0 };
    if (!isUserNotificationsEnabled(env)) {
        console.log('[SEASON_NOTIFICATION] Skipped — USER_NOTIFICATIONS_ENABLED=false');
        return stats;
    }
    let msgText: string;
    let replyMarkup: any = undefined;
    if (type === 'SEASON_END') {
        msgText = `\uD83C\uDFC1 <b>\u0421\u0435\u0437\u043E\u043D ${seasonNumber} \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D!</b>\n\n\u0421\u043F\u0430\u0441\u0438\u0431\u043E \u0437\u0430 \u0443\u0447\u0430\u0441\u0442\u0438\u0435. \u0418\u0442\u043E\u0433\u0438 \u0441\u0435\u0437\u043E\u043D\u0430 \u0443\u0436\u0435 \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u044B.`;
        replyMarkup = {
            inline_keyboard: [
                [miniAppInlineUrlButton(env, '\uD83C\uDFC6 \u0418\u0442\u043E\u0433\u0438 \u0441\u0435\u0437\u043E\u043D\u0430', 'rating')]
            ]
        };
    } else {
        msgText = `\uD83D\uDE80 <b>\u0421\u0435\u0437\u043E\u043D ${seasonNumber} \u043D\u0430\u0447\u0430\u043B\u0441\u044F!</b>\n\n\u041D\u043E\u0432\u044B\u0439 \u0441\u0435\u0437\u043E\u043D \u043E\u0442\u043A\u0440\u044B\u0442, \u043C\u043E\u0436\u043D\u043E \u0434\u0435\u043B\u0430\u0442\u044C \u043F\u0440\u043E\u0433\u043D\u043E\u0437\u044B \u0438 \u0431\u043E\u0440\u043E\u0442\u044C\u0441\u044F \u0437\u0430 \u043B\u0438\u0434\u0435\u0440\u0441\u0442\u0432\u043E.`;
        replyMarkup = {
            inline_keyboard: [
                [miniAppInlineUrlButton(env, '\u26BD \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043C\u0430\u0442\u0447\u0438', 'matches')]
            ]
        };
    }
    const reminderType = type;
    const reminderKey = `season_${seasonNumber}`;
    const dayStr = todayMoscow();
    const usersRes = await env.DB.prepare('SELECT bu.user_id, bu.chat_id FROM bot_users bu WHERE bu.active = 1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)').all();
    const users = (usersRes.results || []) as any[];
    for (const user of users) {
        try {
            if (await wasAlreadySent(env, user.user_id, reminderType, reminderKey)) {
                stats.skipped++;
                continue;
            }
            const result = await sendMessage(env, Number(user.chat_id), msgText, replyMarkup);
            if (result.blocked) {
                stats.blocked++;
                await env.DB.prepare('UPDATE bot_users SET active = 0 WHERE user_id = ?').bind(user.user_id).run();
            } else if (result.ok) {
                stats.sent++;
            } else {
                stats.errors++;
            }
            await logSent(env, Number(user.user_id), dayStr, reminderType, reminderKey, result.message_id);
        } catch (e) {
            stats.errors++;
            console.error(`[${type}] Error for user ${user.user_id}:`, e);
        }
        await new Promise(r => setTimeout(r, 35));
    }
    console.log(`[${type}] season=${seasonNumber} sent=${stats.sent} skipped=${stats.skipped} errors=${stats.errors} blocked=${stats.blocked}`);
    return stats;
}
// Stage 2: throttle marker for maintenance polling. Uses the runtime Cache API
// (caches.default) — available without any binding, so NO new D1 query and NO
// migration is needed just to decide whether to skip a D1 poll. fail-open: any
// cache error falls through to a normal poll so a pending event is never lost.
const MAINTENANCE_POLL_THROTTLE_KEY = "https://throttle.scoregame.local/maintenance-poll";

async function decideMaintenancePoll(flags: BotFeatureFlags): Promise<{ skip: boolean; reason: string }> {
    if (!flags.maintenancePollThrottle) return { skip: false, reason: "throttle_disabled" };
    try {
        const cache = (globalThis as any).caches?.default as Cache | undefined;
        if (!cache) return { skip: false, reason: "no_cache_api_fail_open" };
        const hit = await cache.match(MAINTENANCE_POLL_THROTTLE_KEY);
        if (hit) return { skip: true, reason: "within_interval" };
        const ttlSec = Math.max(60, flags.maintenancePollIntervalMinutes * 60);
        await cache.put(
            MAINTENANCE_POLL_THROTTLE_KEY,
            new Response("1", { headers: { "Cache-Control": `max-age=${ttlSec}` } })
        );
        return { skip: false, reason: "interval_elapsed" };
    } catch {
        return { skip: false, reason: "throttle_error_fail_open" };
    }
}

async function processMaintenanceEvents(env: Env, flags: BotFeatureFlags): Promise<void> {
    const __t0 = Date.now(); const __runId = makeRunId(); let __status = "ok"; let __sent = 0;
    let __polled = true; let __reason = "executed";
    try {
    // Stage 2: only the maintenance D1 poll is throttled; the rest of the
    // scheduled handler keeps running every tick (decision made by caller).
    const decision = await decideMaintenancePoll(flags);
    if (decision.skip) {
        __polled = false; __reason = decision.reason; __status = "skipped";
        return;
    }
    __reason = decision.reason;
    const event = await env.DB.prepare('SELECT * FROM maintenance_events WHERE dispatched_at IS NULL ORDER BY id ASC LIMIT 1').first() as any;
    if (!event) return;
    console.log(`[MAINT_EVENT] Processing event id=${event.id} type=${event.type}`);
    let msgText: string;
    let replyMarkup: any = undefined;
    if (event.type === 'START') {
        const msg = event.message || '\u0418\u0434\u0443\u0442 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0440\u0430\u0431\u043E\u0442\u044B';
        msgText = `\u26A0\uFE0F <b>\u0422\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0440\u0430\u0431\u043E\u0442\u044B</b>\n\n${escapeHtml(msg)}\n\n\u0412 \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u043C\u043E\u0436\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043D\u0435\u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E.`;
    } else {
        msgText = `\u2705 <b>\u0422\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0440\u0430\u0431\u043E\u0442\u044B \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u044B</b>\n\n\u0421\u043F\u0430\u0441\u0438\u0431\u043E \u0437\u0430 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435! \u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0441\u043D\u043E\u0432\u0430 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432 \u043E\u0431\u044B\u0447\u043D\u043E\u043C \u0440\u0435\u0436\u0438\u043C\u0435.`;
        replyMarkup = { inline_keyboard: [[miniAppInlineUrlButton(env, '\u26BD \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435', 'matches')]] };
    }
    if (!isUserNotificationsEnabled(env)) {
        console.log(`[MAINT_EVENT] Skipped mass dispatch because USER_NOTIFICATIONS_ENABLED=false`);
        await env.DB.prepare('UPDATE maintenance_events SET dispatched_at = ?, dispatched_count = ?, error = ? WHERE id = ?').bind(Date.now(), 0, "USER_NOTIFICATIONS_ENABLED=false", event.id).run();
        return;
    }
    const users = await env.DB.prepare('SELECT bu.user_id, bu.chat_id FROM bot_users bu WHERE bu.active = 1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)').all();
    const rows = (users.results || []) as any[];
    let sent = 0;
    let errors = 0;
    let blocked = 0;
    const errorMessages: string[] = [];
    for (const row of rows) {
        const userId = String(row.user_id);
        const chatId = Number(row.chat_id);
        try {
            const already = await env.DB.prepare('SELECT 1 FROM maintenance_event_log WHERE event_id = ? AND user_id = ?').bind(event.id, userId).first();
            if (already) continue;
        } catch { }
        try {
            const result = await sendMessage(env, chatId, msgText, replyMarkup);
            if (result.blocked) {
                blocked++;
                await env.DB.prepare('UPDATE bot_users SET active = 0 WHERE user_id = ?').bind(row.user_id).run();
            } else if (result.ok) {
                sent++;
            } else {
                errors++;
            }
            await env.DB.prepare('INSERT OR IGNORE INTO maintenance_event_log (event_id, user_id, sent_at) VALUES (?, ?, ?)').bind(event.id, userId, Date.now()).run();
        } catch (e: any) {
            errors++;
            if (errorMessages.length < 5) errorMessages.push(e?.message || String(e));
            console.error(`[MAINT_EVENT] Error sending to userId=${userId}:`, e?.message || e);
        }
        await new Promise(r => setTimeout(r, 35));
    }
    const errorStr = errorMessages.length > 0 ? errorMessages.join('; ') : null;
    await env.DB.prepare('UPDATE maintenance_events SET dispatched_at = ?, dispatched_count = ?, error = ? WHERE id = ?').bind(Date.now(), sent, errorStr, event.id).run();
    __sent = sent;
    console.log(`[MAINT_EVENT] Done id=${event.id} sent=${sent} blocked=${blocked} errors=${errors}`);
    } catch (__e) { __status = "error"; throw __e; } finally { logEvent({ operation: __polled ? "maintenance_poll_executed" : "maintenance_poll_skipped", trigger: "cron", run_id: __runId, status: __status, reason_code: __reason, configured_interval_minutes: flags.maintenancePollIntervalMinutes, duration_ms: Date.now() - __t0, processed_users: __sent }); }
}
// ============================================================
// Admin-panel broadcast: drain one batch of the oldest active job per cron tick.
// Idempotent per recipient (broadcast_deliveries PK), resumable across ticks, and
// self-limiting so a large audience never blocks a single invocation.
// ============================================================
const BROADCAST_BATCH_PER_TICK = 800;
// A tick must finish well inside the */2 cron interval, otherwise the next tick
// starts while this one is still sending. The batch size alone cannot guarantee
// that (delivery latency is ~10s/message in practice, not the 35ms sleep), so the
// drain also stops on a wall-clock budget and resumes on the next tick.
const BROADCAST_TICK_BUDGET_MS = 60_000;
// Lease covers the budget plus slack for the in-flight send and the final UPDATE.
const BROADCAST_LEASE_MS = 110_000;

async function processBroadcastJobs(env: Env): Promise<void> {
    // Atomic claim. The previous plain SELECT could not exclude a job another tick
    // was already draining ('sending' is part of the predicate), so overlapping
    // invocations re-sent to every recipient not yet in broadcast_deliveries.
    // Claiming by lease makes a concurrent tick find nothing and exit; a crashed
    // tick releases the job by itself once the lease expires.
    const nowClaim = Date.now();
    const job = await env.DB.prepare(
        `UPDATE broadcast_jobs SET lease_until = ?
         WHERE id = (
           SELECT id FROM broadcast_jobs
           WHERE status IN ('pending','sending')
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY id ASC LIMIT 1
         )
         RETURNING *`
    ).bind(nowClaim + BROADCAST_LEASE_MS, nowClaim).first() as any;
    if (!job) return;

    // Global kill-switch: record the reason on the job so the panel explains the
    // no-op instead of the admin wondering why nothing was delivered.
    if (!isUserNotificationsEnabled(env)) {
        await env.DB.prepare(
            `UPDATE broadcast_jobs SET status = 'canceled', finished_at = ?, error = ?, lease_until = NULL WHERE id = ?`
        ).bind(Date.now(), 'USER_NOTIFICATIONS_ENABLED=false', job.id).run();
        return;
    }

    if (job.status === 'pending') {
        await env.DB.prepare(`UPDATE broadcast_jobs SET status = 'sending', started_at = ? WHERE id = ?`)
            .bind(Date.now(), job.id).run();
    }

    // Segment predicate mirrors the api-worker recipient count exactly.
    // picks.updated_at is MILLISECONDS (Date.now()), so the threshold must be ms too
    // — a seconds threshold silently matches every user who ever picked. Keep in
    // exact sync with api-worker broadcastSegmentPredicate.
    const nowMs = Date.now();
    let segWhere = '';
    const segBinds: any[] = [];
    if (job.segment === 'active_7d') {
        segWhere = `AND EXISTS (SELECT 1 FROM picks p WHERE p.user_id = bu.user_id AND p.updated_at >= ?)`;
        segBinds.push(nowMs - 7 * 86400 * 1000);
    } else if (job.segment === 'active_30d') {
        segWhere = `AND EXISTS (SELECT 1 FROM picks p WHERE p.user_id = bu.user_id AND p.updated_at >= ?)`;
        segBinds.push(nowMs - 30 * 86400 * 1000);
    }

    // Next batch = still-reachable recipients not yet delivered for this job.
    const batch = ((await env.DB.prepare(
        `SELECT bu.user_id, bu.chat_id FROM bot_users bu
         WHERE bu.active = 1 ${segWhere}
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = bu.user_id AND COALESCE(u.is_banned, 0) = 1)
           AND NOT EXISTS (SELECT 1 FROM broadcast_deliveries d WHERE d.job_id = ? AND d.user_id = bu.user_id)
         ORDER BY bu.user_id ASC LIMIT ?`
    ).bind(...segBinds, job.id, BROADCAST_BATCH_PER_TICK).all()).results || []) as any[];

    if (batch.length === 0) {
        await env.DB.prepare(`UPDATE broadcast_jobs SET status = 'done', finished_at = ?, lease_until = NULL WHERE id = ?`)
            .bind(Date.now(), job.id).run();
        return;
    }

    // Free-text admin message: escape so '<', '&' render literally (HTML parse mode).
    const html = escapeHtml(String(job.message || ''));
    let sent = 0, blocked = 0, failed = 0;
    const tickStartedAt = Date.now();
    for (const row of batch) {
        // Stop before the next cron tick would overlap this one. Recipients left
        // over stay unlogged in broadcast_deliveries and are picked up next tick.
        if (Date.now() - tickStartedAt > BROADCAST_TICK_BUDGET_MS) break;
        try {
            const result = await sendMessage(env, Number(row.chat_id), html);
            if (result.blocked) {
                blocked++;
                await env.DB.prepare(`UPDATE bot_users SET active = 0 WHERE user_id = ?`).bind(row.user_id).run();
            } else if (result.ok) {
                sent++;
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
        // Log delivery regardless of outcome so retries never double-send.
        await env.DB.prepare(`INSERT OR IGNORE INTO broadcast_deliveries (job_id, user_id, sent_at) VALUES (?, ?, ?)`)
            .bind(job.id, row.user_id, Date.now()).run();
        await new Promise(r => setTimeout(r, 35));
    }

    await env.DB.prepare(
        `UPDATE broadcast_jobs SET sent_count = sent_count + ?, blocked_count = blocked_count + ?, failed_count = failed_count + ?, lease_until = NULL WHERE id = ?`
    ).bind(sent, blocked, failed, job.id).run();
    console.log(`[BROADCAST] job=${job.id} batch sent=${sent} blocked=${blocked} failed=${failed}`);
}

// ============================================================
// Worker Export
// ============================================================
export default {
    async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);
        if (req.method === 'GET' && url.pathname === '/health') {
            return new Response(JSON.stringify({ ok: true, time: todayMoscow() }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (req.method === 'POST' && url.pathname === '/internal/enable-pm') {
            try {
                if (!hasTrustedApiWorkerRequest(req, env)) {
                    logBotSecurityEvent('deny', '/internal/enable-pm', 'untrusted_internal_source', 401);
                    return new Response('unauth', { status: 401 });
                }
                logBotSecurityEvent('allow', '/internal/enable-pm', 'trusted_api_worker', 200);
                const body: any = await req.json().catch(() => ({}));
                const userId = Number(body?.user_id || 0);
                const chatId = Number(body?.chat_id || body?.user_id || 0);
                const username = body?.username ? String(body.username) : undefined;
                const firstName = body?.first_name ? String(body.first_name) : undefined;
                if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(chatId) || chatId <= 0) {
                    return new Response(JSON.stringify({ ok: false, code: 'INVALID_PM_TARGET' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const existing = await env.DB.prepare(`
                    SELECT chat_id, active
                    FROM bot_users
                    WHERE user_id = ?
                    LIMIT 1
                `).bind(userId).first() as any;
                if (Number(existing?.active || 0) === 1 && Number(existing?.chat_id || 0) === chatId) {
                    // Доступ уже есть, но кнопки может не быть: её начали ставить
                    // здесь позже, а /start такой человек не набирал.
                    await setPersonalMenuButton(env, chatId);
                    return new Response(JSON.stringify({
                        ok: true,
                        already_enabled: true,
                        welcome_sent: false,
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                await upsertBotUser(env, userId, chatId, username, firstName);
                const sent = await sendBotWelcomeMessage(env, userId, chatId);
                if (sent.blocked) {
                    return new Response(JSON.stringify({
                        ok: false,
                        code: 'BOT_WRITE_ACCESS_NOT_AVAILABLE',
                    }), {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                if (!sent.ok) {
                    return new Response(JSON.stringify({
                        ok: false,
                        code: 'WELCOME_SEND_FAILED',
                    }), {
                        status: 502,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                // Право писать подтверждено доставленным приветствием — теперь
                // кнопка «Открыть» такая же, как у прошедших /start.
                await setPersonalMenuButton(env, chatId);
                return new Response(JSON.stringify({
                    ok: true,
                    already_enabled: false,
                    welcome_sent: true,
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (e: any) {
                console.error('[ENABLE_PM] Error:', e);
                return new Response(JSON.stringify({ ok: false, error: e?.message || 'internal error' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
        if (req.method === 'POST' && url.pathname === '/internal/resend-summary') {
            try {
                const body: any = await req.json();
                const day = body.day;
                const replaceExisting = body.replaceExisting === true;
                if (!day) return new Response("missing day", { status: 400 });
                if (!hasTrustedApiWorkerRequest(req, env)) {
                    logBotSecurityEvent('deny', '/internal/resend-summary', 'untrusted_internal_source', 401);
                    return new Response("unauth", { status: 401 });
                }
                logBotSecurityEvent('allow', '/internal/resend-summary', 'trusted_api_worker', 200);
                console.log(`[RESEND] Triggered for day=${day}, replaceExisting=${replaceExisting}`);
                // Use isResend=true: admin can request hard replace instead of edit-in-place.
                const resendResult = await sendDailySummary(env, day, true, replaceExisting);
                return new Response(JSON.stringify({ ok: true, ...resendResult }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            } catch (e: any) {
                console.error('[RESEND] Error:', e);
                return new Response(e.message, { status: 500 });
            }
        }
        if (req.method === 'POST' && url.pathname === '/internal/create-star-invoice') {
            try {
                if (!hasTrustedApiWorkerRequest(req, env)) {
                    logBotSecurityEvent('deny', '/internal/create-star-invoice', 'untrusted_internal_source', 401);
                    return new Response('unauth', { status: 401 });
                }
                logBotSecurityEvent('allow', '/internal/create-star-invoice', 'trusted_api_worker', 200);
                const body: any = await req.json();
                const orderId = String(body?.orderId || '').trim();
                const invoicePayload = String(body?.invoicePayload || '').trim();
                const title = String(body?.title || '').trim();
                const description = String(body?.description || '').trim();
                const priceXtr = Math.max(1, Number(body?.priceXtr || 0));
                if (!orderId || !invoicePayload || !title || !description || !Number.isFinite(priceXtr)) {
                    return new Response(JSON.stringify({ ok: false, error: 'invalid payload' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const res = await tgApi(env.BOT_TOKEN, 'createInvoiceLink', {
                    title,
                    description,
                    payload: invoicePayload,
                    provider_token: '',
                    currency: 'XTR',
                    prices: [
                        { label: title, amount: priceXtr }
                    ]
                });
                if (res.status !== 200 || !res.body?.ok || !res.body?.result) {
                    return new Response(JSON.stringify({
                        ok: false,
                        error: res.body?.description || `telegram_${res.status}`
                    }), {
                        status: 502,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                return new Response(JSON.stringify({
                    ok: true,
                    order_id: orderId,
                    invoice_link: String(res.body.result),
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (e: any) {
                return new Response(JSON.stringify({ ok: false, error: e?.message || 'invoice failed' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
        if (req.method === 'POST' && url.pathname === '/internal/refund-star-order') {
            try {
                if (!hasTrustedApiWorkerRequest(req, env)) {
                    logBotSecurityEvent('deny', '/internal/refund-star-order', 'untrusted_internal_source', 401);
                    return new Response('unauth', { status: 401 });
                }
                logBotSecurityEvent('allow', '/internal/refund-star-order', 'trusted_api_worker', 200);
                const body: any = await req.json();
                const orderId = String(body?.orderId || '').trim();
                const adminUserId = Number(body?.adminUserId || 0);
                if (!orderId) {
                    return new Response(JSON.stringify({ ok: false, error: 'ORDER_ID_REQUIRED' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const order = await getStarOrderById(env, orderId);
                if (!order) {
                    return new Response(JSON.stringify({ ok: false, error: 'ORDER_NOT_FOUND' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                if (String(order.status || '') === 'refunded' || Number(order.refunded_at || 0) > 0) {
                    return new Response(JSON.stringify({ ok: true, already_refunded: true, order_id: orderId }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const chargeId = String(order.telegram_payment_charge_id || '').trim();
                const totalBalls = Math.max(0, Number(order.total_balls || 0));
                if (!chargeId) {
                    return new Response(JSON.stringify({ ok: false, error: 'TELEGRAM_CHARGE_MISSING' }), {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const recovery = await getStarRefundRecoveryState(env, order);
                if (recovery.spendDetected || recovery.unspentPurchaseBalls < totalBalls) {
                    return new Response(JSON.stringify({
                        ok: false,
                        error: 'SPEND_AFTER_PURCHASE'
                    }), {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                if (recovery.currentBalance < totalBalls) {
                    return new Response(JSON.stringify({ ok: false, error: 'CURRENT_BALANCE_BELOW_PACK' }), {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const tgRes = await tgApi(env.BOT_TOKEN, 'refundStarPayment', {
                    user_id: Number(order.user_id),
                    telegram_payment_charge_id: chargeId,
                });
                if (tgRes.status !== 200 || !tgRes.body?.ok || tgRes.body?.result !== true) {
                    return new Response(JSON.stringify({
                        ok: false,
                        error: tgRes.body?.description || `telegram_${tgRes.status}`,
                    }), {
                        status: 502,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                await logStarOrderEvent(env, orderId, 'refund_requested_by_admin', {
                    admin_user_id: Number.isFinite(adminUserId) ? adminUserId : null,
                    telegram_payment_charge_id: chargeId,
                });
                await refundTelegramStarOrder(env, order, {
                    telegram_payment_charge_id: chargeId,
                    provider_payment_charge_id: order.provider_payment_charge_id || null,
                    requested_by_admin: true,
                    admin_user_id: Number.isFinite(adminUserId) ? adminUserId : null,
                });
                return new Response(JSON.stringify({
                    ok: true,
                    order_id: orderId,
                    refunded: true,
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (e: any) {
                return new Response(JSON.stringify({ ok: false, error: e?.message || 'refund failed' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
        // Internal: season notification broadcast
        
        if (req.method === 'POST' && url.pathname === '/internal/register-commands') {
            try {
                if (!hasTrustedApiWorkerRequest(req, env)) {
                    logBotSecurityEvent('deny', '/internal/register-commands', 'untrusted_internal_source', 401);
                    return new Response('unauth', { status: 401 });
                }
                logBotSecurityEvent('allow', '/internal/register-commands', 'trusted_api_worker', 200);
                const result = await syncTelegramBotProfile(env);
                return new Response(JSON.stringify({ ok: true, result }), {
                     status: 200, headers: { 'Content-Type': 'application/json' }
                });
            } catch (e: any) {
                return new Response(e.message, { status: 500 });
            }
        }
        if (req.method === 'POST' && url.pathname === '/internal/season-notification') {
            try {
                if (!hasTrustedApiWorkerRequest(req, env)) {
                    logBotSecurityEvent('deny', '/internal/season-notification', 'untrusted_internal_source', 401);
                    return new Response('unauth', { status: 401 });
                }
                const body: any = await req.json().catch(() => ({}));
                const type = String(body?.type || '');
                const seasonNumber = Number(body?.season_number || 0);
                if (type !== 'SEASON_END' && type !== 'SEASON_START') {
                    return new Response('invalid type', { status: 400 });
                }
                if (!seasonNumber || !Number.isFinite(seasonNumber)) {
                    return new Response('invalid season_number', { status: 400 });
                }
                console.log(`[SEASON_NOTIFY] type=${type} season=${seasonNumber}`);
                const result = await sendSeasonNotification(env, type, seasonNumber);
                return new Response(JSON.stringify({ ok: true, ...result }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e: any) {
                console.error('[SEASON_NOTIFY] Error:', e);
                return new Response(e.message, { status: 500 });
            }
        }
        // Telegram webhook handler (must be last route)
        if (req.method === 'POST') {
            return handleWebhook(req, env);
        }
        return new Response('Not Found', { status: 404 });
    },
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        console.log(`[CRON] triggered: ${event.cron} at ${new Date().toISOString()}`);

        // Stage 1: resolve feature flags once per cron tick and emit a single
        // diagnostic snapshot. Flags are inert at default (control flow unchanged).
        const __flags: BotFeatureFlags = resolveBotFlags(env);
        logEvent({ operation: "cron_flags_snapshot", trigger: event.cron, run_id: makeRunId(), status: "ok", flags: __flags });

        try {
            await cronPredictionsOpen(env);
            console.log('[CRON] cronPredictionsOpen done');
        } catch (e) {
            console.error('[CRON] cronPredictionsOpen error:', e);
        }
        try {
            await cronReminders(env);
            console.log('[CRON] cronReminders done');
        } catch (e) {
            console.error('[CRON] cronReminders error:', e);
        }
        try {
            await cronDailySummary(env);
            console.log('[CRON] sendDailySummary done');
        } catch (e) {
            console.error('[CRON] sendDailySummary error:', e);
        }
        // Process pending maintenance broadcast events (only this poll is throttled)
        try {
            await processMaintenanceEvents(env, __flags);
        } catch (e) {
            console.error('Maintenance events cron error:', e);
        }
        // Drain one batch of the oldest active admin-panel broadcast job.
        try {
            await processBroadcastJobs(env);
        } catch (e) {
            console.error('Broadcast jobs cron error:', e);
        }
        // Cleanup old logs once per hour (if cron is at minute 0)
        const minute = new Date().getUTCMinutes();
        if (minute < 2) {
            ctx.waitUntil(cleanupOldLogs(env));
        }
    },
};
