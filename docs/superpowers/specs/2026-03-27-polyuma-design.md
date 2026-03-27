# Polyuma — UMA 争议者追踪与 Polymarket 交易信号系统

## 概述

监控 Polymarket 在 UMA Optimistic Oracle 上的所有争议事件，追踪争议者历史胜率，当高胜率争议者发起新争议时发出通知，为 Polymarket 反转事件提供早期交易信号。

## 核心策略

- Polymarket 使用 UMA Optimistic Oracle 做市场结算
- 提案被成功推翻 = Polymarket 上的反转事件
- 追踪历史上成功推翻提案的争议者（disputer），计算其胜率
- 实时监控新争议事件，匹配高胜率争议者，作为买入信号

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    polyuma                           │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  历史同步器   │───▶│                          │   │
│  │ (Subgraph)   │    │       SQLite 数据库       │   │
│  └──────────────┘    │                          │   │
│                      │  - 事件表 (propose/       │   │
│  ┌──────────────┐    │    dispute/settle)        │   │
│  │  实时监听器   │───▶│  - 争议者画像表           │   │
│  │ (RPC WS)    │    │  - 市场关联缓存           │   │
│  └──────┬───────┘    └──────────┬───────────────┘   │
│         │                       │                   │
│         ▼                       ▼                   │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  匹配引擎    │◀───│   争议者画像计算器        │   │
│  │ (胜率≥60%?)  │    │   (胜率/争议数/历史)      │   │
│  └──────┬───────┘    └──────────────────────────┘   │
│         │ 命中                                      │
│         ▼                                           │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │ Polymarket   │───▶│     通知发送器            │   │
│  │ 数据enricher │    │   (xxnotify API)          │   │
│  │ (价格/订单簿) │    └──────────────────────────┘   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘

外部依赖:
  - Goldsky Subgraph (Polygon OOV2) — 历史数据
  - Polygon RPC WebSocket — 实时事件
  - Ethereum RPC — DVM 投票结果 (低频)
  - Gamma API — Polymarket 市场信息
  - CLOB API — Polymarket 订单簿
  - xxnotify — 通知推送 (独立部署)
```

### 模块职责

| 模块 | 职责 | 运行模式 |
|------|------|---------|
| 历史同步器 | 从 Subgraph 拉取全量历史事件 | 首次全量 + 每小时增量 |
| 实时监听器 | WebSocket 监听新的链上事件 | 常驻进程 |
| 争议者画像计算器 | 关联事件链，计算每个地址的胜率 | 增量后触发 |
| 匹配引擎 | 新争议事件 vs 高胜率地址库 | 实时触发 |
| Polymarket enricher | 解码 ancillaryData，获取市场价格/订单簿 | 按需调用 |
| 通知发送器 | 格式化并推送到 xxnotify | 按需调用 |

## 数据模型

```sql
-- 1. 提案事件表
proposals (
  id              TEXT PRIMARY KEY,  -- UMA request ID (hash)
  requester       TEXT,              -- UMA adapter 合约地址
  proposer        TEXT,              -- 提案者地址
  identifier      TEXT,              -- 价格标识符
  timestamp       INTEGER,           -- 请求时间戳
  ancillary_data  TEXT,              -- 原始 hex 数据
  proposed_price  TEXT,              -- 提议的价格 (0=No, 1e18=Yes)
  expiration_time INTEGER,           -- 提案过期时间
  currency        TEXT,              -- 保证金币种
  block_number    INTEGER,
  tx_hash         TEXT,
  created_at      DATETIME
)

-- 2. 争议事件表
disputes (
  id              TEXT PRIMARY KEY,
  proposal_id     TEXT REFERENCES proposals(id),
  disputer        TEXT,              -- 争议者地址
  dispute_timestamp INTEGER,
  block_number    INTEGER,
  tx_hash         TEXT,
  created_at      DATETIME
)

-- 3. 结算事件表
settlements (
  id              TEXT PRIMARY KEY,
  proposal_id     TEXT REFERENCES proposals(id),
  settlement_price TEXT,             -- 最终结算价格
  proposer        TEXT,
  disputer        TEXT,
  payout          TEXT,              -- 赔付金额
  settled_timestamp INTEGER,
  block_number    INTEGER,
  tx_hash         TEXT,
  created_at      DATETIME
)

-- 4. 争议者画像表 (计算生成)
disputer_profiles (
  address         TEXT PRIMARY KEY,
  total_disputes  INTEGER,           -- 总争议次数
  wins            INTEGER,           -- 胜出次数
  losses          INTEGER,           -- 失败次数
  win_rate        REAL,              -- 胜率
  total_payout    TEXT,              -- 累计收益
  first_seen      DATETIME,
  last_seen       DATETIME,
  is_watched      BOOLEAN DEFAULT FALSE,  -- 胜率≥60% AND 争议≥3次
  updated_at      DATETIME
)

-- 5. Polymarket 市场缓存
market_cache (
  market_id       TEXT PRIMARY KEY,  -- 从 ancillaryData 提取
  proposal_id     TEXT REFERENCES proposals(id),
  title           TEXT,
  slug            TEXT,
  outcome_yes_price TEXT,
  outcome_no_price  TEXT,
  active          BOOLEAN,
  volume          TEXT,
  fetched_at      DATETIME
)

-- 6. 通知记录
alert_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id      TEXT REFERENCES disputes(id),
  disputer        TEXT,
  disputer_win_rate REAL,
  market_id       TEXT,
  market_title    TEXT,
  notified_at     DATETIME,
  notification_status TEXT           -- success/failed
)
```

### 关键查询逻辑

争议胜负判定：
```
disputes JOIN proposals ON proposal_id
         JOIN settlements ON proposal_id
WHERE settlements.settlement_price ≠ proposals.proposed_price
  → 争议者胜出
```

画像更新条件：
```
win_rate = wins / total_disputes
is_watched = (win_rate >= 0.6 AND total_disputes >= 3)
```

## 核心流程

### 历史同步器

1. 检查 DB 最新的 block_number
2. 有数据: 从该 block 之后增量查询 Subgraph
3. 无数据: 全量查询 (分页, 每次1000条)
4. 数据源: Goldsky Polygon OOV2 端点 (免费, 无需 API key)
5. 筛选: requester IN [已知 UmaCtfAdapter 地址列表]
6. 同步完成后触发画像计算器
7. 增量模式: 每小时运行一次

### 实时监听器

1. Polygon RPC WebSocket 订阅 MOOV2 合约的 DisputePrice 和 Settle 事件
2. 过滤: requester IN [UmaCtfAdapter 地址列表]
3. 收到 DisputePrice → 写入 DB → 进入匹配引擎
4. 收到 Settle → 写入 DB → 更新争议者画像
5. 断线重连: 指数退避 (1s → 2s → 4s → ... 最大60s)，重连后从 DB 最新 block 补漏

### 匹配引擎

1. 收到新 DisputePrice 事件
2. 查询 disputer_profiles: WHERE address = 争议者 AND is_watched = TRUE
3. 未命中 → 记录事件，不告警
4. 命中 → enrichment 流程:
   - 解码 ancillaryData → 提取 market_id
   - Gamma API → 市场标题、状态、URL
   - CLOB API → 当前价格、订单簿深度
   - 构造通知 → 发送到 xxnotify

### 通知消息格式

```
高胜率争议者发起争议

争议者: 0xAbCd...1234
历史胜率: 78.5% (11/14)
争议类型: 推翻 Yes → No

Polymarket 市场:
  标题: Will X happen by Y?
  当前价格: Yes 0.72 / No 0.28
  24h成交量: $1.2M
  链接: https://polymarket.com/event/...

UMA 事件:
  Tx: https://polygonscan.com/tx/0x...
  挑战期结束: 2026-03-28 14:00 UTC
```

## 监控合约地址

```
Polygon:
  MOOV2:            0xee3afe347d5c74317041e2618c49534daf887c24
  UmaCtfAdapter:    0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d (negRisk)
  UmaCtfAdapter:    0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49 (v3.0)
  UmaCtfAdapter:    0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74 (v2.0)

Ethereum (仅 DVM 升级时):
  VotingV2:         0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac
```

## UMA 到 Polymarket 关联路径

验证通过的关联方式:

```
UMA ancillaryData (hex)
  → 解码 UTF-8
  → 正则提取 market_id
  → Gamma API /markets/{market_id}
  → 完整 Polymarket 市场数据
```

交叉验证:
- UMA record hash == Polymarket `negRiskRequestID`
- UMA `requester` == Polymarket `resolvedBy`
- ancillaryData `initializer` == Polymarket `submitted_by`

## 外部 API 端点

| API | 端点 | 认证 |
|-----|------|------|
| Goldsky Subgraph (Polygon OOV2) | `https://api.goldsky.com/api/public/project_clus2fndawbcc01w31192938i/subgraphs/polygon-optimistic-oracle-v2/1.1.0/gn` | 无需 |
| Goldsky Subgraph (Managed OOV2) | `https://api.studio.thegraph.com/query/1057/polygon-managed-optimistic-oracle-v2/1.2.0` | 无需 |
| Gamma API | `https://gamma-api.polymarket.com/markets/{id}` | 无需 |
| CLOB API | `https://clob.polymarket.com/book?token_id={id}` | 无需 |
| Ethereum VotingV2 Subgraph | `https://api.studio.thegraph.com/query/1057/mainnet-voting-v2/1.2.0` | 无需 |

## 项目结构

```
polyuma/
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── src/
│   ├── index.ts                  -- 入口
│   ├── config.ts                 -- 环境变量 & 常量
│   ├── db/
│   │   ├── schema.ts             -- SQLite 建表 & 迁移
│   │   └── client.ts             -- DB 连接实例
│   ├── sync/
│   │   ├── subgraph.ts           -- Subgraph GraphQL 客户端
│   │   └── historical-sync.ts    -- 历史数据同步逻辑
│   ├── monitor/
│   │   ├── event-listener.ts     -- WebSocket 订阅 & 重连
│   │   └── event-parser.ts       -- 链上事件 ABI 解析
│   ├── analysis/
│   │   ├── event-linker.ts       -- 关联 propose → dispute → settle
│   │   ├── profile-builder.ts    -- 争议者画像计算
│   │   └── matcher.ts            -- 匹配引擎
│   ├── polymarket/
│   │   ├── ancillary-decoder.ts  -- ancillaryData → market_id
│   │   ├── gamma-client.ts       -- Gamma API
│   │   └── clob-client.ts        -- CLOB API
│   └── notify/
│       ├── formatter.ts          -- 通知消息格式化
│       └── client.ts             -- xxnotify HTTP 客户端
└── data/
    └── polyuma.db                -- SQLite (Docker volume)
```

## 技术栈

| 用途 | 包 | 说明 |
|------|-----|------|
| 运行时 | Node.js 20 LTS | - |
| 以太坊交互 | ethers v6 | ABI 编解码、WebSocket |
| SQLite | better-sqlite3 | 同步 API，高性能 |
| 定时任务 | node-cron | 增量同步调度 |
| 日志 | pino | 结构化 JSON 日志 |
| 类型校验 | zod | Subgraph/API 响应校验 |
| HTTP | node 原生 fetch | 无需额外依赖 |

注意: 所有依赖使用实现时的最新版本。

## 部署

```yaml
services:
  polyuma:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - polyuma-data:/data
    depends_on:
      - xxnotify

  xxnotify:
    build: ../xxnotify
    restart: unless-stopped
    env_file: ../xxnotify/.env
    ports:
      - "8080:8080"
```

### 启动流程

1. 初始化 SQLite (建表/迁移)
2. 启动历史同步器 (首次全量)
3. 计算争议者画像
4. 启动实时 WebSocket 监听器
5. 启动增量同步定时任务 (每小时)

## 配置参数

```env
POLYGON_RPC_WS=wss://...
POLYGON_RPC_HTTP=https://...
ETHEREUM_RPC_HTTP=https://...
MIN_WIN_RATE=0.6
MIN_DISPUTES=3
SYNC_INTERVAL_MINUTES=60
XXNOTIFY_URL=http://xxnotify:8080
XXNOTIFY_API_KEY=xxn_xxx
XXNOTIFY_CHANNELS=telegram
DB_PATH=/data/polyuma.db
LOG_LEVEL=info
```
