// 玻璃板回收与二次涂布准入台 —— 业务记录
// 所有登记、留档、失效重算在此落库；重复提交与并发请求沿用首次结果。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATE_STATUS,
  plateStatuses,
  NEGATIVE_STATUS,
  isIntakePassed,
  defectSummary,
  nextStatusAfterIntake,
  checkClean,
  cleanConfirmed,
  recalculate,
} from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "cyanotype-negative-room.json");

// 内存中的在途请求：同幂等键的重复/并发调用直接等首次结果
const inflight = new Map();

const seed = {
  negatives: [
    {
      code: "CN-001",
      plateSize: "18x24cm",
      chemicalBatch: "B-0620",
      exposure: "8分钟",
      waterSource: "井水过滤",
      box: "蓝盒A-03",
      status: "已交付",
      defect: "边角显影不均",
      deliveredAt: "2026-06-21",
      logs: [
        { at: "2026-06-20", step: "曝光", note: "阴天补时2分钟" },
        { at: "2026-06-21", step: "入盒", note: "放入A盒" },
      ],
    },
    {
      code: "CN-002",
      plateSize: "13x18cm",
      chemicalBatch: "B-0624",
      exposure: "6分钟",
      waterSource: "井水过滤",
      box: "蓝盒A-05",
      status: "已交付",
      defect: "",
      deliveredAt: "2026-06-22",
      logs: [{ at: "2026-06-22", step: "交付", note: "待拆片回收玻璃板" }],
    },
  ],
  plates: [
    {
      code: "GP-001",
      plateSize: "18x24cm",
      sourceNegative: "CN-001",
      status: "待复洗",
      revision: 1,
      intake: {
        at: "2026-09-20T02:10:00.000Z",
        scratch: "边缘一道浅划痕",
        emulsion: "无残留",
        cleaner: "林阿秀",
      },
      cleanChecks: [],
      archive: [],
      history: [
        {
          at: "2026-09-20T02:10:00.000Z",
          type: "intake",
          revision: 1,
          detail: "划痕不达标（边缘一道浅划痕）；乳剂残留达标；清洗人已登记",
          toStatus: "待复洗",
        },
      ],
    },
    {
      code: "GP-002",
      plateSize: "13x18cm",
      sourceNegative: "CN-002",
      status: "待复认",
      revision: 1,
      intake: {
        at: "2026-09-21T01:30:00.000Z",
        scratch: "无",
        emulsion: "无",
        cleaner: "林阿秀",
      },
      cleanChecks: [
        { seq: 1, at: "2026-09-21T02:00:00.000Z", confirmer: "周明和", note: "透光检查无污痕", revision: 1 },
      ],
      archive: [],
      history: [
        {
          at: "2026-09-21T01:30:00.000Z",
          type: "intake",
          revision: 1,
          detail: "三项均达标",
          toStatus: "待复认",
        },
        {
          at: "2026-09-21T02:00:00.000Z",
          type: "clean",
          revision: 1,
          seq: 1,
          confirmer: "周明和",
          note: "透光检查无污痕",
        },
      ],
    },
  ],
  coating: [],
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.negatives ||= [];
  db.plates ||= [];
  db.coating ||= [];
  // 兼容旧版仅有 items 结构的数据
  if (db.items && !db.negatives.length) {
    db.negatives = db.items;
    delete db.items;
    await writeFile(dbPath, JSON.stringify(db, null, 2));
  }
  return db;
}

let saveChain = Promise.resolve();
async function saveDb(db) {
  const snapshot = JSON.stringify(db, null, 2);
  saveChain = saveChain.then(() => writeFile(dbPath, snapshot));
  return saveChain;
}

// 串行化 + 幂等键：同一 key 的重复/并发请求共用首次执行结果
async function withIdempotency(key, fn) {
  const hit = inflight.get(key);
  if (hit) return hit;
  const run = (async () => {
    try {
      const db = await loadDb();
      return await fn(db);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

function nowIso(input) {
  return input?.at || new Date().toISOString();
}
function findPlate(db, code) {
  return db.plates.find((p) => p.code === code);
}
function findNegative(db, code) {
  return db.negatives.find((n) => n.code === code);
}
function plateView(plate) {
  return {
    ...plate,
    defectSummary: defectSummary(plate.intake),
    intakePassed: isIntakePassed(plate.intake),
    cleanConfirmed: cleanConfirmed(plate),
    cleanProgress: (plate.cleanChecks || []).filter((c) => c.revision === plate.revision).length,
  };
}

// ---------- 查询 ----------
export async function listNegatives() {
  const db = await loadDb();
  return db.negatives;
}
export async function listPlates() {
  const db = await loadDb();
  return db.plates.map(plateView);
}
// 待涂布队列：只有两次洁净确认完成、结论仍有效的板才能占用涂布槽
export async function coatingQueue() {
  const db = await loadDb();
  return db.plates.filter((p) => p.status === PLATE_STATUS.READY && cleanConfirmed(p)).map(plateView);
}
export async function plateHistory(code) {
  const db = await loadDb();
  const plate = findPlate(db, code);
  if (!plate) return null;
  return plateView(plate);
}

// ---------- 旧底片 ----------
export async function createNegative(input) {
  return withIdempotency(`negative:create:${input.code || ""}:${JSON.stringify(input)}`, async (db) => {
    if (!input.code || !String(input.code).trim()) throw httpError(400, "底片编号必填");
    if (findNegative(db, input.code)) throw httpError(409, "底片编号已存在");
    const item = {
      code: String(input.code).trim(),
      plateSize: input.plateSize || "",
      chemicalBatch: input.chemicalBatch || "",
      exposure: input.exposure || "",
      waterSource: input.waterSource || "",
      box: input.box || "",
      status: NEGATIVE_STATUS.includes(input.status) ? input.status : "待曝光",
      defect: input.defect || "",
      logs: [{ at: nowIso(input), step: "建档", note: "创建底片" }],
    };
    db.negatives.unshift(item);
    await saveDb(db);
    return { status: 201, data: item };
  });
}

export async function patchNegative(code, input) {
  return withIdempotency(`negative:patch:${code}:${JSON.stringify(input)}`, async (db) => {
    const item = findNegative(db, code);
    if (!item) throw httpError(404, "item_not_found");
    if (input.status && !NEGATIVE_STATUS.includes(input.status)) {
      throw httpError(400, "未知状态");
    }
    Object.assign(item, input);
    item.logs ||= [];
    if (input.status) item.logs.push({ at: nowIso(input), step: "状态", note: "更新为" + input.status });
    await saveDb(db);
    return { status: 200, data: item };
  });
}

export async function addNegativeLog(code, input) {
  return withIdempotency(`negative:log:${code}:${JSON.stringify(input)}`, async (db) => {
    const item = findNegative(db, code);
    if (!item) throw httpError(404, "item_not_found");
    item.logs ||= [];
    item.logs.push({ at: nowIso(input), step: input.step || "记录", note: input.note || "" });
    await saveDb(db);
    return { status: 201, data: item };
  });
}

// 旧底片状态回退：已交付的底片回退 -> 关联玻璃板回用结论失效重算，旧记录留档
export async function rollbackNegative(code, input) {
  return withIdempotency(`negative:rollback:${code}:${input.at || ""}:${input.note || ""}`, async (db) => {
    const item = findNegative(db, code);
    if (!item) throw httpError(404, "item_not_found");
    const from = item.status;
    item.status = "已回退";
    item.logs ||= [];
    const at = nowIso(input);
    item.logs.push({ at, step: "回退", note: input.note || `状态由「${from}」回退` });
    const affected = [];
    for (const plate of db.plates.filter((p) => p.sourceNegative === code)) {
      if (plate.status === PLATE_STATUS.COATED) {
        plate.archive ||= [];
        plate.archive.push({
          at,
          type: "source-rollback-after-coat",
          note: `来源底片 ${code} 在涂布后回退，记录留档，涂布不撤销`,
        });
      } else {
        plate.archive ||= [];
        plate.archive.push({
          at,
          type: "source-rollback",
          fromStatus: plate.status,
          fromRevision: plate.revision,
          note: `来源底片 ${code} 状态由「${from}」回退`,
          intake: plate.intake ? { ...plate.intake } : null,
          cleanChecks: (plate.cleanChecks || []).map((c) => ({ ...c })),
        });
        recalculate(plate, `旧底片 ${code} 状态由「${from}」回退，回用结论失效重算`, at);
        affected.push(plate.code);
      }
    }
    await saveDb(db);
    return { status: 200, data: { negative: item, invalidatedPlates: affected } };
  });
}

// ---------- 玻璃板回收 ----------
// 旧底片交付后登记：划痕、乳剂残留、清洗人；任一缺陷未达标 -> 待复洗
export async function intakePlate(input) {
  return withIdempotency(`plate:intake:${input.code || ""}:${JSON.stringify(input)}`, async (db) => {
    if (!input.code || !String(input.code).trim()) throw httpError(400, "玻璃板编号必填");
    if (findPlate(db, input.code)) throw httpError(409, "玻璃板编号已存在");
    const source = input.sourceNegative ? findNegative(db, input.sourceNegative) : null;
    if (input.sourceNegative && !source) throw httpError(404, "来源旧底片不存在");
    if (source && source.status !== "已交付") {
      throw httpError(400, `来源底片状态为「${source.status}」，须交付后方可登记回收`);
    }
    const at = nowIso(input);
    const plate = {
      code: String(input.code).trim(),
      plateSize: input.plateSize || source?.plateSize || "",
      sourceNegative: input.sourceNegative || "",
      status: "待复洗",
      revision: 1,
      intake: {
        at,
        scratch: (input.scratch || "").trim(),
        emulsion: (input.emulsion || "").trim(),
        cleaner: (input.cleaner || "").trim(),
      },
      cleanChecks: [],
      archive: [],
      history: [],
    };
    plate.status = nextStatusAfterIntake(plate);
    plate.history.push({
      at,
      type: "intake",
      revision: plate.revision,
      detail: defectSummary(plate.intake),
      toStatus: plate.status,
    });
    db.plates.unshift(plate);
    await saveDb(db);
    return { status: 201, data: plateView(plate) };
  });
}

// 复洗后重新登记三项验收
export async function rewritePlate(code, input) {
  return withIdempotency(`plate:rewash:${code}:${JSON.stringify(input)}`, async (db) => {
    const plate = findPlate(db, code);
    if (!plate) throw httpError(404, "plate_not_found");
    if (plate.status !== PLATE_STATUS.REWASH) {
      throw httpError(400, `当前为「${plate.status}」，仅待复洗玻璃板可重新登记`);
    }
    const at = nowIso(input);
    plate.archive ||= [];
    plate.archive.push({
      at,
      type: "rewash",
      revision: plate.revision,
      intake: { ...plate.intake },
      cleanChecks: (plate.cleanChecks || []).map((c) => ({ ...c })),
      note: input.note || "复洗后重新登记",
    });
    plate.intake = {
      at,
      scratch: (input.scratch ?? "").toString().trim(),
      emulsion: (input.emulsion ?? "").toString().trim(),
      cleaner: (input.cleaner ?? "").toString().trim(),
    };
    plate.cleanChecks = [];
    plate.status = nextStatusAfterIntake(plate);
    plate.history.push({
      at,
      type: "rewash",
      revision: plate.revision,
      detail: defectSummary(plate.intake),
      toStatus: plate.status,
    });
    await saveDb(db);
    return { status: 200, data: plateView(plate) };
  });
}

// 回用前由另一人连续两次确认表面洁净，间隔四小时
export async function cleanConfirm(code, input) {
  return withIdempotency(`plate:clean:${code}:${input.at || ""}:${input.confirmer || ""}`, async (db) => {
    const plate = findPlate(db, code);
    if (!plate) throw httpError(404, "plate_not_found");
    const result = checkClean(plate, input);
    if (!result.ok) throw httpError(400, result.error);
    const entry = {
      seq: result.seq,
      at: result.at,
      confirmer: input.confirmer.trim(),
      note: input.note || "",
      revision: plate.revision,
    };
    plate.cleanChecks ||= [];
    plate.cleanChecks.push(entry);
    plate.history.push({ at: entry.at, type: "clean", ...entry });
    if (cleanConfirmed(plate)) {
      plate.status = PLATE_STATUS.READY;
      plate.history.push({
        at: entry.at,
        type: "ready",
        revision: plate.revision,
        detail: "两次洁净确认完成，准入二次涂布",
        toStatus: plate.status,
      });
    }
    await saveDb(db);
    return { status: 201, data: plateView(plate) };
  });
}

// 占用涂布槽（待涂布队列中的板）
export async function coatPlate(code, input) {
  return withIdempotency(`plate:coat:${code}:${input.at || ""}:${input.batch || ""}`, async (db) => {
    const plate = findPlate(db, code);
    if (!plate) throw httpError(404, "plate_not_found");
    if (plate.status !== PLATE_STATUS.READY || !cleanConfirmed(plate)) {
      throw httpError(400, "未通过回用准入，不能占用涂布槽");
    }
    const at = nowIso(input);
    const slot = db.coating.find((c) => c.slot === input.slot && c.status === "涂布中");
    if (input.slot && slot) throw httpError(409, `涂布槽 ${input.slot} 已被 ${slot.plate} 占用`);
    const record = {
      plate: plate.code,
      slot: input.slot || "",
      batch: input.batch || "",
      operator: input.operator || "",
      at,
      revision: plate.revision,
      status: "涂布中",
    };
    db.coating.push(record);
    plate.status = PLATE_STATUS.COATED;
    plate.history.push({
      at,
      type: "coat",
      revision: plate.revision,
      detail: `占用涂布槽 ${record.slot || "未指定"}，药液批次 ${record.batch || "未登记"}`,
      toStatus: plate.status,
    });
    await saveDb(db);
    return { status: 201, data: { plate: plateView(plate), coating: record } };
  });
}

// 玻璃板档案更正：任何更正都让当前回用结论失效，升版本重算，旧记录留档
export async function correctPlate(code, input) {
  return withIdempotency(`plate:correct:${code}:${JSON.stringify(input)}`, async (db) => {
    const plate = findPlate(db, code);
    if (!plate) throw httpError(404, "plate_not_found");
    const at = nowIso(input);
    plate.archive ||= [];
    plate.archive.push({
      at,
      type: "correction",
      fromRevision: plate.revision,
      record: {
        code: plate.code,
        plateSize: plate.plateSize,
        sourceNegative: plate.sourceNegative,
        intake: plate.intake ? { ...plate.intake } : null,
        cleanChecks: (plate.cleanChecks || []).map((c) => ({ ...c })),
      },
      note: input.note || "玻璃板档案更正",
      changes: input.changes || {},
    });
    const fields = ["plateSize", "sourceNegative", "scratch", "emulsion", "cleaner"];
    for (const key of fields) if (input[key] !== undefined) {
      if (["scratch", "emulsion", "cleaner"].includes(key)) plate.intake[key] = String(input[key]).trim();
      else plate[key] = String(input[key]).trim();
    }
    if (plate.intake) plate.intake.at = plate.intake.at || at;
    recalculate(plate, `玻璃板档案更正（${input.note || "字段更正"}），回用结论失效重算`, at);
    await saveDb(db);
    return { status: 200, data: plateView(plate) };
  });
}

export async function stats() {
  const db = await loadDb();
  const plate = Object.fromEntries(plateStatuses.map((s) => [s, 0]));
  for (const p of db.plates) if (plate[p.status] !== undefined) plate[p.status] += 1;
  const negative = Object.fromEntries(NEGATIVE_STATUS.map((s) => [s, 0]));
  for (const n of db.negatives) if (negative[n.status] !== undefined) negative[n.status] += 1;
  return {
    plate,
    negative,
    coatingQueue: db.plates.filter((p) => p.status === PLATE_STATUS.READY && cleanConfirmed(p)).length,
    coatingOccupied: db.coating.filter((c) => c.status === "涂布中").length,
  };
}

class HttpError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
  }
}
function httpError(status, error) {
  return new HttpError(status, error);
}
export { HttpError };
