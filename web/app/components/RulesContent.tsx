"use client";

function SectionCard({
    icon,
    title,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            background: 'var(--tg-bg)',
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
        }}>
            <h2 style={{
                fontSize: 16,
                fontWeight: 700,
                marginTop: 0,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
            }}>
                <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
                <span>{title}</span>
            </h2>
            {children}
        </div>
    );
}

function RulesList({ items }: { items: React.ReactNode[] }) {
    return (
        <ul style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: 1.8,
            color: 'var(--tg-text)',
        }}>
            {items.map((item, index) => (
                <li key={index}>{item}</li>
            ))}
        </ul>
    );
}

function ScoreRow({
    label,
    value,
    background,
    border,
    color,
}: {
    label: string;
    value: string;
    background: string;
    border?: string;
    color: string;
}) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            background,
            borderRadius: 10,
            border: border || 'none',
        }}>
            <span style={{ fontSize: 14 }}>{label}</span>
            <span style={{ fontWeight: 700, color }}>{value}</span>
        </div>
    );
}

export default function RulesContent({
    paddingBottom = 24,
}: {
    paddingBottom?: number;
}) {
    return (
        <div style={{ padding: 16, paddingBottom }}>
            <SectionCard icon="⚽" title="Матчи дня">
                <RulesList
                    items={[
                        <>Основной режим игры: каждый игровой день в разделе <strong>«Матчи дня»</strong> появляется подборка матчей. Игровой день живёт по московскому времени.</>,
                        'Поставьте точный счёт по каждому матчу до его начала. Пока матч не стартовал, прогноз и джокер можно менять сколько угодно раз; после стартового свистка — уже нельзя.',
                        'После расчёта результатов очки, задания и рейтинги обновляются автоматически.',
                    ]}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tg-hint)', marginBottom: 2 }}>Очки за матч</div>
                    <ScoreRow
                        label="Точный счёт"
                        value="5 очков"
                        background="rgba(52, 199, 89, 0.1)"
                        border="1px solid rgba(52, 199, 89, 0.2)"
                        color="color-mix(in srgb, #34c759 82%, var(--tg-text))"
                    />
                    <ScoreRow
                        label="Угадали разницу мячей"
                        value="3 очка"
                        background="rgba(255, 149, 0, 0.1)"
                        border="1px solid rgba(255, 149, 0, 0.2)"
                        color="color-mix(in srgb, #FF9500 82%, var(--tg-text))"
                    />
                    <ScoreRow
                        label="Угадали исход (П1 / Х / П2)"
                        value="2 очка"
                        background="rgba(0, 122, 255, 0.1)"
                        border="1px solid rgba(0, 122, 255, 0.2)"
                        color="color-mix(in srgb, #007AFF 82%, var(--tg-text))"
                    />
                    <ScoreRow
                        label="Не угадали"
                        value="0 очков"
                        background="rgba(128,128,128,0.1)"
                        color="var(--tg-hint)"
                    />
                </div>
                <div style={{ marginTop: 10 }}>
                    <RulesList
                        items={[
                            <>Очки считаются по счёту <strong>основного времени</strong> (90 минут с учётом добавленного). Овертайм и серия пенальти на очки не влияют — даже в кубковых матчах.</>,
                            'Перенесённые и отменённые матчи не участвуют в подсчёте — очков по ним не получает никто.',
                        ]}
                    />
                </div>
                <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tg-hint)', marginBottom: 8 }}>Джокер и бусты</div>
                    <RulesList
                        items={[
                            <><strong>Джокер</strong> — 1 на игровой день, удваивает очки за выбранный матч (например, 5 → 10).</>,
                            <>Буст <strong>«Дополнительный джокер»</strong> открывает второй джокер на этот же день.</>,
                            <>Буст <strong>«Двойной шанс»</strong> приносит 2 очка, если твой прогноз не принёс очков, но исход матча попал в выбранный вариант (1X, X2 или 12). Если прогноз зашёл сам — очки идут за прогноз, буст ничего не добавляет.</>,
                            '«Двойной шанс» не действует на матче с джокером — выбирайте для них разные матчи.',
                            'За один игровой день можно использовать только один платный буст.',
                            'Если матч с «Двойным шансом» перенесли или отменили, буст автоматически вернётся в инвентарь после завершения игрового дня.',
                        ]}
                    />
                </div>
                <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tg-hint)', marginBottom: 8 }}>Бонус-вопросы</div>
                    <RulesList
                        items={[
                            <>У части матчей есть дополнительные вопросы (кто пройдёт дальше, кто забьёт и т.п.). За правильные ответы начисляются <strong>звёзды</strong>.</>,
                        ]}
                    />
                </div>
            </SectionCard>

            <SectionCard icon="🎯" title="Задания">
                <RulesList
                    items={[
                        'В игре есть ежедневные, еженедельные и партнёрские задания.',
                        <>За выполнение заданий выдаются <strong>звёзды, мячи и кейсы</strong>.</>,
                        <>Закройте <strong>4 и более ежедневных задания</strong> за день — получите дневной кейс.</>,
                        'Часть заданий считается отдельно по каждой вашей лиге.',
                        <>У режимов <strong>«Прогнозы сезона»</strong> и <strong>«Вызов недели»</strong> есть свои отдельные задания (см. ниже).</>,
                    ]}
                />
            </SectionCard>

            <SectionCard icon="🏆" title="Рейтинг">
                <RulesList
                    items={[
                        'Таблицы лидеров считаются за день, неделю и сезон.',
                        'Отдельно есть рейтинги по лигам и по каналам.',
                        'Так видно ваше место среди всех игроков и внутри ваших лиг.',
                    ]}
                />
            </SectionCard>

            <SectionCard icon="👥" title="Лиги">
                <RulesList
                    items={[
                        'Соревнуйтесь с друзьями в лигах. У каждой лиги свой рейтинг и список участников.',
                        <>В приватной лиге — до <strong>25 участников</strong>. Лига канала без ограничения по размеру.</>,
                        <>Бесплатно можно <strong>создать</strong> до 5 приватных лиг и 1 лигу канала; дополнительные слоты покупаются в магазине. Вступать в чужие лиги можно без ограничений.</>,
                        'Для лиги канала название и аватар подтягиваются из привязанного Telegram-канала.',
                        <><strong>Сыгравшим</strong> считается участник, у которого есть прогнозы с результатом за этот день или неделю — просто состоять в лиге недостаточно.</>,
                        <>Задания на <strong>место в лиге</strong> засчитываются, только когда есть конкуренция: для <strong>1-го места</strong> нужно <strong>минимум 2 сыгравших</strong>, для <strong>топ-3</strong> — <strong>минимум 3</strong>. Остальные лиговые задания (например, «День с очками») выполняются при любом числе участников.</>,
                        'При равенстве очков в таблицах дня и недели выше тот, у кого больше точных счетов, затем — больше угаданных разниц, затем — больше угаданных исходов. Если совпало всё, место общее.',
                    ]}
                />
            </SectionCard>

            <SectionCard icon="🗓️" title="Прогнозы сезона">
                <RulesList
                    items={[
                        <>Долгая игра на весь сезон, отдельно от режима <strong>«Матчи дня»</strong>.</>,
                        <>Соберите <strong>финальные таблицы топ-5 лиг</strong> и предскажите <strong>сетки еврокубков</strong>.</>,
                        'У режима свой рейтинг и свои задания — за активность в таблицах лиг и еврокубках.',
                        <>Награды за задания режима: <strong>звёзды, мячи, кейсы и жетоны</strong>.</>,
                        'Очки начисляются по мере того, как турниры доходят до финиша.',
                    ]}
                />
            </SectionCard>

            <SectionCard icon="🔥" title="Вызов недели">
                <RulesList
                    items={[
                        'Появляется перед футбольным уикендом.',
                        <><strong>5 быстрых вопросов</strong> по выбранным матчам.</>,
                        'Успейте ответить до дедлайна — и поборитесь в отдельном рейтинге вызова.',
                        <>У вызова свои задания: за участие и ответы начисляются <strong>звёзды, мячи, кейсы и жетоны</strong>.</>,
                    ]}
                />
            </SectionCard>

            <SectionCard icon="🛒" title="Магазин">
                <RulesList
                    items={[
                        <>Бусты (<strong>«Дополнительный джокер»</strong>, <strong>«Двойной шанс»</strong>) и кейсы.</>,
                        <><strong>Кейсы</strong> — случайная награда: мячи, звёзды, бусты, жетоны и другие бонусы. Шансы и содержимое видны на экране кейса.</>,
                        <><strong>Мячи</strong> — основная игровая валюта, на них покупаются бусты и кейсы.</>,
                        <><strong>Звёзды</strong> — копятся за задания и бонус-вопросы и обмениваются на мячи (лимит обмена — на неделю). Звёзды не сгорают: остаток переносится в новый сезон.</>,
                        <><strong>Колесо фортуны</strong> — крутите за мячи или за жетон. Жетоны выдаются за задания, вызов недели и прогнозы сезона.</>,
                        'Часть покупок доступна за Telegram Stars.',
                    ]}
                />
            </SectionCard>

            <SectionCard icon="🎁" title="Пригласи друга">
                <RulesList
                    items={[
                        'Персональная ссылка-приглашение — в карточке «Пригласи друга» в профиле.',
                        <>Друг считается <strong>активированным</strong>, когда сделает свой первый прогноз, — и сразу получает приветственную награду.</>,
                        'Вы получаете награду за каждого активированного друга, а за 3, 5 и 10 друзей — дополнительные бонусы.',
                        'Актуальный список наград показан в самой карточке в профиле.',
                    ]}
                />
            </SectionCard>

            <SectionCard icon="👤" title="Профиль">
                <RulesList
                    items={[
                        'Ваша статистика и достижения.',
                        'Имя подтягивается из Telegram; здесь — аватарка и настройки приватности.',
                        'Настройки напоминаний о матчах.',
                    ]}
                />
            </SectionCard>
        </div>
    );
}
