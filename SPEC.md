# ТЗ: Agent Guardrails для Ryze AI

Nov 21, 2026 · @Victor

## Суть

Делаем за 3 дня рабочее демо «Agent Guardrails»: правила для ИИ-агента Ryze, которые проверяются на сервере перед каждым изменением. Клиент пишет правила обычными словами («бюджет меняй сам до $50, больше — спроси меня», «бренд-кампанию не трогай»), и они действуют одинаково в чате и через MCP.

Итог проверки один из трёх: **пропустить**, **нужно подтверждение** или **заблокировать**, и всегда с понятной причиной. Демо отправляем фаундеру вместе с откликом на Founding Engineer, чтобы показать продуктовое мышление и скорость, а не только стек.

Главный кадр демо: просьба «Pause Brand Search» из веб-чата и из Claude через MCP упирается в одно и то же правило. Защита не зависит от того, включил ли клиент подтверждения у себя.

## Проблема у Ryze

Защита от лишних действий агента зависит от того, откуда пришёл запрос, а единых правил на сервере в справке нет. Всё ниже взято из публичной справки и changelog на 21.11.2026, внутри продукта не проверено.

| Где | Что написано у них | Источник |
| --- | --- | --- |
| Чат | По умолчанию стоит Skip all approvals: агент сам меняет бюджеты, кампании и контент. Режимов три, выбор хранится в браузере | [Chat](https://help.get-ryze.ai/agent/chat.md), [Paid Ads FAQ](https://help.get-ryze.ai/paid-ads/faq.md) |
| MCP (Claude) | Подтверждения включаются в настройках коннектора в самом Claude. Проверяет ли что-то Ryze у себя, не сказано | [Permissions & Approvals](https://help.get-ryze.ai/claude/permissions.md) |
| Agent API | У ключа нет режима «только чтение», подтверждений и лимитов. Один ключ открывает все воркспейсы владельца | [Ryze API for agents](https://help.get-ryze.ai/agent-api.md) |
| Slack | Обратиться к агенту может любой участник канала. Про подтверждения ничего нет | [Connect Slack](https://help.get-ryze.ai/integrations/slack.md) |
| Расписания | Задача может менять и удалять данные. Справка обещает карточку на подтверждение, а статья в их блоге говорит, что шага подтверждения нет | [Scheduled Tasks](https://help.get-ryze.ai/agent/schedules.md), [блог](https://www.get-ryze.ai/claude-skills-for-woocommerce) |
| Команда | Ролей две: владелец и участник. Роли «только просмотр» нет | [Invite Teammates](https://help.get-ryze.ai/workspaces/invite-teammates.md) |
| Везде | Нет денежных порогов, защиты отдельных кампаний и журнала изменений агента в чате | [Paid Ads FAQ](https://help.get-ryze.ai/paid-ads/faq.md) |

**Что у них уже есть (не копируем, а опираемся):** Inbox с карточками «до/после», доказательствами, ожидаемым эффектом и откатом ([справка: Approvals](https://help.get-ryze.ai/agent/approvals.md)); потолок бюджета и запрос на +20% в Managed Campaigns ([справка: Managed Campaigns](https://help.get-ryze.ai/paid-ads/managed-campaigns.md)). С ноября решения по карточкам можно принимать из чата и через MCP. Мы переносим ту же логику туда, где её нет: на действия агента из чата, MCP и API.

**Почему это боль:** Ryze продаёт «автономного маркетолога» и активно развивает MCP: в changelog за август–ноябрь про него больше десятка записей. Чем больше клиентов подключают Ryze к своим ассистентам, тем больше изменений идёт мимо настроек чата. Серверные правила закрывают все входы разом.

## Объём MVP

Делаем четыре вещи и ничего больше: цель — аккуратное демо, а не продукт.

**Делаем**

1. **Движок проверки.** Чистая функция `evaluate()` с тестами и четырьмя типами правил. Итог: пропустить, нужно подтверждение или блок, с причиной.
2. **Правила обычными словами.** Клиент пишет правило, LLM превращает его в строгий JSON, клиент видит «как я понял» и подтверждает.
3. **Два настоящих входа через одну проверку.** Веб-чат с демо-агентом и MCP-сервер, который подключается к Claude. Оба вызывают один и тот же серверный код.
4. **Журнал решений.** Все проверки в одном списке: действие, сработавшее правило, канал (чат или MCP), кнопки Approve / Deny.

**Не делаем**

- Подключение к настоящим Google Ads или Meta: только демо-данные.
- Роли, Slack и расписания: описываем в README в разделе «что дальше».
- Правила по времени и общий лимит расходов.
- Регистрацию: у каждого посетителя свой демо-воркспейс по cookie.
- Свой Inbox и откат: у Ryze они уже есть, мы только показываем, что запрос «нужно подтверждение» уходит туда.
- Мобильную версию, фильтры и счётчики в журнале.

**Если останется время:** вход по API-ключу (`POST /api/v1/actions`) с той же проверкой. Это третий канал в журнале и прямой ответ на их Agent API.

## Демо-сценарий

Фаундер за минуту должен увидеть три исхода проверки и то, что они одинаковы в двух каналах. Демо открывается без регистрации, с уже заполненными правилами и кнопкой «Reset demo».

1. Открывает ссылку — видит демо-воркспейс «Acme Outdoor» с 4 кампаниями и тремя правилами.
2. Пишет новое правило: «Never change bids by more than 20%». Система показывает, как поняла правило, он нажимает Save.
3. В чате с агентом пишет: «Lower bids on Retargeting by 10%» → **прошло само**, правила не нарушены. Если написать «by 30%», сработает только что добавленное правило.
4. «Increase Prospecting budget by $80/day» → **нужно подтверждение**: «больше вашего порога $50». Запрос появляется в журнале с кнопками Approve / Deny.
5. «Pause Brand Search, it's too expensive» → **заблокировано**: «Brand Search защищена правилом № 1». Агент объясняет это в чате и предлагает альтернативу. Здесь срабатывают сразу два правила (№ 1 и № 3), побеждает более строгое.
6. Копирует MCP-адрес из интерфейса, подключает его в Claude и повторяет шаг 5 там — тот же блок, в журнале появляется запись с меткой MCP. Главная мысль: правила проверяет сервер, и они не зависят от настроек клиента.

Шаг 6 фаундер может не пройти сам, поэтому он обязательно есть в видео.

## Экраны

Одна страница в три колонки, интерфейс на английском, в стиле Ryze: светлый бежевый фон, тёмная боковая панель, чёрные кнопки, крупный жирный заголовок.

| Зона | Что там | Главное действие |
| --- | --- | --- |
| Слева: Rules | Список правил карточками: текст клиента, ниже «как понял агент» мелким шрифтом, переключатель вкл/выкл. Поле «Add a rule in plain English» | Написать правило → предпросмотр → Save |
| Центр: Agent chat | Чат с демо-агентом. Действие агента показано карточкой «было/стало» с цветным статусом. Над чатом строка «Connect to Claude» с MCP-адресом воркспейса | Написать задачу агенту; скопировать MCP-адрес |
| Справа: Decision log | Журнал всех проверок, новые сверху. В записи: статус, действие, сработавшее правило, метка канала (Chat / MCP), время. Обновляется сам раз в несколько секунд | Approve / Deny для «нужно подтверждение» |
| Верхняя полоса | Название воркспейса, кнопка Reset demo | Сбросить демо |

Цвета статусов: зелёный — прошло само, жёлтый — нужно подтверждение, красный — заблокировано. Вёрстка только под десктоп.

## Логика правил

Решение принимает обычный код на сервере, а не LLM и не клиент: модель только переводит текст правила в JSON и пишет объяснение. Это главный инженерный аргумент для фаундера: проверка предсказуема, покрыта тестами, и её нельзя обойти настройками ассистента.

**Типы правил (четыре):**

| Тип | Пример текста | Исход при срабатывании |
| --- | --- | --- |
| `protect` | «Never touch Brand Search» | Блок |
| `max_change_abs` | «Budget changes over $50/day need my approval» | Подтверждение или блок (задаётся) |
| `max_change_pct` | «Never change bids by more than 20%» | То же |
| `action_policy` | «Pausing a campaign always needs approval» | Подтверждение |

**Формат правила (валидируется через Zod):**

```json
{
  "type": "max_change_abs",
  "scope": { "campaigns": "all", "actions": ["budget_change"] },
  "params": { "amount": 50, "unit": "usd_per_day" },
  "outcome": "require_approval",
  "source_text": "Budget changes over $50/day need my approval"
}
```

**Как идёт проверка действия:**

1. Запрос приходит из веб-чата или через MCP: тип действия, кампания, новое значение, причина. Канал сервер определяет сам по входу.
2. Сервер берёт текущее значение («было») из базы. Модель его не присылает, иначе проценты считались бы от выдуманного числа.
3. Функция `evaluate(action, rules)` проходит по всем включённым правилам и собирает сработавшие.
4. Итог — самый строгий исход: блок сильнее подтверждения, подтверждение сильнее «пропустить». Ни одно не сработало — пропустить.
5. Результат пишется в журнал. «Пропустить» сразу меняет демо-кампанию, «подтверждение» ждёт кнопку, «блок» ничего не меняет.
6. Демо-агент или внешний ассистент получает вердикт как ответ инструмента и объясняет его своими словами.

**Перевод текста в правило.** Claude получает текст клиента и список кампаний, отвечает JSON по схеме (structured output). Если правило неоднозначно («не трать много»), модель не угадывает, а задаёт один уточняющий вопрос. Невалидный JSON — один повтор, потом понятная ошибка.

**MCP-сервер.** Эндпоинт в том же приложении, два инструмента: `list_campaigns` (чтение) и `propose_action` (запись). `propose_action` вызывает ту же функцию, что и веб-чат. Адрес содержит идентификатор воркспейса, поэтому действия из Claude попадают в журнал того же посетителя.

## Данные

Пять таблиц в Postgres плюс сид-скрипт. У каждого посетителя свой воркспейс, чтобы чужие правила и чужой Reset не попали фаундеру на экран.

| Таблица | Ключевые поля | Зачем |
| --- | --- | --- |
| `workspaces` | id, created_at | Отдельное демо на посетителя: id лежит в cookie и стоит в MCP-адресе |
| `campaigns` | id, workspace_id, name, platform (google / meta), daily_budget_usd, bid_usd, status | Демо-кампании, которые меняет агент |
| `rules` | id, workspace_id, source_text, type, scope (jsonb), params (jsonb), outcome, enabled, created_at | Правила рабочего пространства |
| `actions` | id, workspace_id, channel (chat / mcp), action_type, campaign_id, before (jsonb), after (jsonb), reason, created_at | Что предложил агент |
| `decisions` | id, action_id, verdict (allow / require_approval / block), matched_rule_ids, explanation, resolved_by, resolved_at | Итог проверки и решение человека |

**Демо-аккаунт «Acme Outdoor»:**

| Кампания | Платформа | Бюджет, $/день | Ставка, $ | Особенность |
| --- | --- | --- | --- | --- |
| Brand Search | Google | 120 | 2.50 | Защищена правилом |
| Prospecting — Lookalike | Meta | 200 | 1.80 | Под проверку порога $50 |
| Retargeting | Meta | 80 | 1.20 | Мелкие правки ставок проходят сами |
| Shopping — New Arrivals | Google | 150 | 0.90 | Запасная, для свободных проверок |

Три стартовых правила, в таком порядке: № 1 «Never touch Brand Search», № 2 «Budget changes over $50/day need my approval», № 3 «Pausing a campaign always needs approval». Reset demo удаляет всё в воркспейсе посетителя и заново заливает сид.

## Стек и репозиторий

Стек совпадает с тем, что Ryze просит в вакансии: TypeScript, Next.js, Postgres, LLM API.

- **Next.js (App Router) + TypeScript**, Tailwind для стилей.
- **Postgres** в Neon или Supabase, Drizzle ORM и миграции.
- **Claude API** через Anthropic SDK: перевод правил и демо-агент с tool use.
- **MCP**: официальный TypeScript SDK, эндпоинт в том же приложении. Перед стартом сверить по документации актуальный способ для Next.js на Vercel.
- **Zod** для схемы правил, **Vitest** для тестов проверки.
- **Vercel** для деплоя, публичный репозиторий на GitHub.

**Структура:**

```
agent-guardrails/
  app/
    page.tsx                      — три колонки
    api/rules/route.ts            — создать, вкл/выкл правило
    api/rules/parse/route.ts      — текст → JSON через Claude
    api/agent/route.ts            — веб-чат с демо-агентом
    api/mcp/[workspace]/route.ts  — MCP-сервер
    api/decisions/route.ts        — журнал, approve / deny
    api/reset/route.ts            — сброс демо
  lib/
    rules/schema.ts               — Zod-схема правил
    rules/evaluate.ts             — проверка действия (чистая функция)
    rules/evaluate.test.ts
    actions/propose.ts            — общий вход: «было» из базы → evaluate → журнал
    llm/parse-rule.ts
    llm/agent.ts
    db/schema.ts, db/seed.ts
  README.md
```

Сердце проекта — `evaluate.ts` с тестами и `propose.ts`, через который идут оба канала. Их технический фаундер откроет первыми.

## План на 3 дня

К концу первого дня работают проверка с тестами и деплой на Vercel. Второй день — LLM и MCP, третий — интерфейс и упаковка.

| Блок | Что готово в конце | Часов |
| --- | --- | --- |
| День 1, утро | Проект, БД, сид, воркспейс по cookie, пустой деплой на Vercel | 3 |
| День 1, день | Zod-схема правил, `evaluate.ts`, 12–15 тестов на четыре типа | 3 |
| День 1, вечер | `propose.ts` и API: правила, журнал, approve / deny, reset | 2 |
| День 2, утро | Перевод текста в правило и демо-агент с tool use | 4 |
| День 2, день | MCP-сервер, проверка из Claude | 3 |
| День 3, утро | Интерфейс: три колонки, статусы, строка с MCP-адресом | 5 |
| День 3, день | Прогон демо-сценария, README, видео, письмо | 3 |
| Все три дня | Чтение диффов и разбор кода | 2 |

Итого около 25 часов. Если отстаёте, режьте в таком порядке: вход по API-ключу, карточки «было/стало» в чате (заменить простым текстом), уточняющий вопрос при неоднозначном правиле. Не режьте `evaluate.ts`, перевод правил и MCP: без MCP демо превращается в обычную форму с правилами. Запишите фактические часы: цифра пойдёт в письмо.

## Задания для Claude Code

Перед первым заданием положите это ТЗ в репозиторий как `SPEC.md`. Каждое задание — отдельный коммит: история коммитов тоже показывает, как вы работаете.

1. **Каркас.** «Read SPEC.md. Scaffold a Next.js App Router + TypeScript + Tailwind project. Add Drizzle with Postgres, create tables workspaces, campaigns, rules, actions, decisions as in the Data section. Each visitor gets their own workspace from a cookie, seeded with the Acme Outdoor demo. Add a /api/reset route that wipes the visitor's workspace and reseeds it.»
2. **Проверка.** «Implement lib/rules/schema.ts (Zod, four rule types from SPEC.md) and lib/rules/evaluate.ts as a pure function evaluate(action, rules) that returns verdict, matched rules and a human-readable reason. Strictest outcome wins. Write Vitest tests for every rule type, for combinations of rules and for disabled rules.»
3. **Общий вход и API.** «Add lib/actions/propose.ts: take action type, campaign, new value, reason and channel; read the current value from the database; call evaluate(); write the action and the decision; apply the change only on allow. Add routes: create and toggle rules, list decisions newest first, approve and deny a pending decision. Approve applies the change to the demo campaign; deny leaves it unchanged.»
4. **Перевод правил.** «Add lib/llm/parse-rule.ts: send the rule text and the campaign list to Claude, get JSON matching the Zod schema. If the rule is ambiguous, return one clarifying question instead of guessing. Retry once on invalid JSON, then return a clear error.»
5. **Демо-агент.** «Add lib/llm/agent.ts: a chat agent with two tools, list_campaigns and propose_action(type, campaign, value, reason). propose_action calls lib/actions/propose.ts with channel "chat". The agent receives the verdict as the tool result and explains it to the user, suggesting an alternative when the action is blocked.»
6. **MCP-сервер.** «Add an MCP server at /api/mcp/[workspace] with the same two tools, list_campaigns and propose_action. propose_action calls lib/actions/propose.ts with channel "mcp". Reject unknown workspace ids. Follow the current official MCP TypeScript SDK docs for a Next.js route on Vercel.»
7. **Интерфейс.** «Build the single page from the Screens section: Rules on the left, Agent chat in the centre with a "Connect to Claude" row showing the workspace MCP URL and a Copy button, Decision log on the right that refreshes every few seconds and shows a channel badge, a top bar with Reset demo. Light beige background, dark sidebar, black buttons, green / amber / red statuses. Desktop only.»
8. **Проверка сценария.** «Walk through the six demo steps from SPEC.md, including the MCP step, and fix whatever breaks. Add IP rate limiting to the LLM routes. Then write README.md as described in the Delivery section.»

После каждого задания сами прочитайте дифф и запустите тесты. На собеседовании попросят объяснить код, и ответ «это написал Claude» не подойдёт.

## Сдача

Фаундер получает три ссылки: демо, код и видео. Всё на английском, кроме письма.

**README (до одного экрана):**

- Одна фраза о проблеме со ссылками на их справку: Chat, Permissions & Approvals, Paid Ads FAQ.
- Скриншот или GIF: один запрос из веб-чата и из Claude, один и тот же блок.
- Архитектура в 5 строках: решает код на сервере, LLM только переводит и объясняет, оба канала идут через `propose.ts`.
- Как встроить в Ryze: правила живут в воркспейсе, проверка вызывается перед каждым write-инструментом в чате, MCP и Agent API, «нужно подтверждение» уходит в существующий Inbox.
- Что дальше: правила по ролям и по автору запроса в Slack, задачи по расписанию, общий лимит расходов, ограничения на API-ключ.
- Сколько часов заняло.
- Запуск локально в 3 команды и как подключить MCP-адрес к Claude.

**Видео (60–90 секунд, Loom или запись экрана):** 10 секунд про проблему, затем шаги 4–5 в веб-чате, затем шаг 6 в Claude и запись в журнале с меткой MCP. В конце 10 секунд на `evaluate.ts` и зелёные тесты. Говорить можно по-русски: фаундеры из Москвы, и вакансия на русском.

**Письмо фаундеру (Telegram):**

> [Имя], привет! Откликнулся на Founding Engineer. Изучил вашу справку и заметил: в чате агент по умолчанию меняет бюджеты без подтверждения, а в MCP, судя по справке, подтверждения включаются в настройках самого Claude. За [N] часов собрал Agent Guardrails: клиент пишет правила обычными словами, и сервер проверяет по ним каждое действие агента, из чата и через MCP одинаково. Next.js + Postgres + Claude API. Демо: [ссылка] · Код: [GitHub] · Видео: [ссылка]. Делал по публичной справке: если внутри уже иначе, подстрою. Буду рад созвониться.

В форме отклика в поле «Почему вы?» — те же три ссылки и две строки о том, что сделано. GitHub указать обязательно, хотя поле необязательное.

## Риски

| Риск | Что делаем |
| --- | --- |
| Внутри Ryze уже есть серверная проверка, просто справка о ней молчит | В письме стоит «судя по справке» и «делал по публичной справке». Смотрят на скорость и качество, а не на угаданную фичу |
| Не укладываемся в 3 дня | Режем по правилу из плана. `evaluate.ts` и MCP не трогаем |
| MCP не подключится у фаундера | Шаг 6 показан в видео, в README инструкция в три строки. Перед отправкой подключить адрес с нуля в чистом профиле |
| Демо сломается у фаундера | Свой воркспейс на посетителя, кнопка Reset demo, прогон сценария с чистого браузера перед отправкой |
| Ключ Claude API сжигают посторонние | Лимит запросов по IP, дешёвая модель для демо, месячный лимит расходов в консоли |
| На собеседовании не объясните код | Читать каждый дифф, самим написать часть тестов `evaluate.ts` |
| Фаундер уже выбрал кандидата | Отправить как можно раньше: 3 дня, а не неделя. По их странице найма весь процесс занимает около недели |

## Источники

- [Ryze Help: Chat with the AI Marketer](https://help.get-ryze.ai/agent/chat.md)
- [Ryze Help: Permissions & Approvals (Claude)](https://help.get-ryze.ai/claude/permissions.md)
- [Ryze Help: Ryze API for agents](https://help.get-ryze.ai/agent-api.md)
- [Ryze Help: Paid Ads FAQ](https://help.get-ryze.ai/paid-ads/faq.md)
- [Ryze Help: Scheduled Tasks](https://help.get-ryze.ai/agent/schedules.md)
- [Ryze Help: Connect Slack](https://help.get-ryze.ai/integrations/slack.md)
- [Ryze Help: Invite Teammates](https://help.get-ryze.ai/workspaces/invite-teammates.md)
- [Ryze Help: Inbox and approvals](https://help.get-ryze.ai/agent/approvals.md)
- [Ryze Help: Managed Campaigns](https://help.get-ryze.ai/paid-ads/managed-campaigns.md)
- [Ryze Changelog](https://www.get-ryze.ai/changelog)
- [Блог Ryze: Claude Skills for WooCommerce](https://www.get-ryze.ai/claude-skills-for-woocommerce) — раздел Approvals: у задач по расписанию нет шага подтверждения
- [Ryze Careers](https://www.get-ryze.ai/careers)
- [Вакансия Founding Engineer](https://ryze-founding-engineer-ru.vercel.app/)
