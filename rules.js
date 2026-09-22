// 玻璃板回收与二次涂布准入台 —— 业务规则文件
// 纯函数：接收 db 与输入，返回受影响玻璃板；所有写库与持久化由记录层负责。

export const STATUS = Object.freeze({
  PENDING_DELIVERY: "待登记交付",
  REWASH: "待复洗",
  AWAIT_CONFIRM: "待洁净确认",
  READY: "准予回用",
  COATING: "涂布中",
  COATED: "已二次涂布",
  ROLLED_BACK: "已回退",
});
export const STATUSES = Object.freeze(Object.values(STATUS));

export const PASS = "合格";
export const FAIL = "不合格";
export const RESULTS = Object.freeze([PASS, FAIL]);
export const SCRATCH_PASS_NOTE = "划痕浅于0.05mm";
export const RESIDUE_PASS_NOTE = "无乳剂残留";
export const CONFIRM_REQUIRED_TIMES = 2;
export const CONFIRM_INTERVAL_MS = 4 * 60 * 60 * 1000; // 两次确认间隔四小时
export const COATING_SLOTS = Object.freeze(["涂布槽1号", "涂布槽2号", "涂布槽3号"]);

export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuleError";
    this.code = code;
  }
}

export function ts(at) {
  return at ? new Date(at).toISOString() : new Date().toISOString();
}
function t(at) {
  return new Date(at).getTime();
}

function mustFind(db, code) {
  const plate = db.plates.find((p) => p.code === code);
  if (!plate) throw new RuleError("plate_not_found", `玻璃板 ${code} 不存在`);
  return plate;
}

function addHistory(db, plate, type, note, at) {
  db.history.push({
    id: "H-" + ++db.seq,
    plateCode: plate.code,
    epoch: plate.epoch,
    version: plate.version,
    type,
    note,
    at: ts(at),
  });
}

// 归档当前这一轮（检验 + 确认），旧记录留档，不删除
function archiveRound(db, plate, reason, at) {
  if (plate.currentInspection) {
    db.archives.push({
      id: "A-" + ++db.seq,
      plateCode: plate.code,
      version: plate.version,
      epoch: plate.epoch,
      inspection: structuredClone(plate.currentInspection),
      confirmations: structuredClone(plate.confirmations),
      reason,
      archivedAt: ts(at),
    });
    plate.archivedCount += 1;
  }
  plate.currentInspection = null;
  plate.confirmations = [];
}

// 仅使回用结论失效（档案更正场景）：检验事实保留，确认必须重做
function invalidateConclusion(db, plate, reason, at) {
  if (plate.currentInspection) {
    db.archives.push({
      id: "A-" + ++db.seq,
      plateCode: plate.code,
      version: plate.version,
      epoch: plate.epoch,
      inspection: structuredClone(plate.currentInspection),
      confirmations: structuredClone(plate.confirmations),
      reason,
      archivedAt: ts(at),
    });
    plate.archivedCount += 1;
    plate.confirmations = [];
  }
}

function normalizeResult(value, label) {
  if (value !== PASS && value !== FAIL) {
    throw new RuleError("bad_result", `${label}必须为「${PASS}」或「${FAIL}」`);
  }
  return value;
}

function hasDefect(ins) {
  return ins.scratchResult === FAIL || ins.residueResult === FAIL;
}

// 依据档案/检验/确认重算准入结论（列表、队列、履历共用同一口径）
export function deriveConclusion(plate) {
  switch (plate.status) {
    case STATUS.PENDING_DELIVERY:
      return { key: "尚未登记旧底片交付", admitted: false };
    case STATUS.ROLLED_BACK:
      return { key: "旧底片已回退，等待重新交付", admitted: false };
    case STATUS.COATING:
      return { key: "已占用涂布槽，涂布中", admitted: true };
    case STATUS.COATED:
      return { key: "已完成二次涂布", admitted: true };
    default:
      break;
  }
  if (!plate.currentInspection) return { key: plate.status, admitted: false };
  if (hasDefect(plate.currentInspection)) {
    return { key: STATUS.REWASH + "（只留待复洗，不占用涂布槽）", admitted: false };
  }
  if (plate.confirmations.length < CONFIRM_REQUIRED_TIMES) {
    return {
      key: `待洁净确认（${plate.confirmations.length}/${CONFIRM_REQUIRED_TIMES}，间隔四小时）`,
      admitted: false,
    };
  }
  return { key: STATUS.READY + "，可进入待涂布队列", admitted: true };
}

// 1. 玻璃板建档
export function createPlate(db, input = {}, at) {
  const code = (input.code || "").trim();
  if (!code) throw new RuleError("missing_code", "玻璃板编号必填");
  const existing = db.plates.find((p) => p.code === code);
  if (existing) return existing; // 重复请求沿用首次结果
  const plate = {
    id: "GP-" + ++db.seq,
    code,
    plateSize: input.plateSize || "",
    source: input.source || "",
    note: input.note || "",
    status: STATUS.PENDING_DELIVERY,
    version: 1,
    epoch: 0, // 档案更正或旧底片回退都会让 epoch 前进，旧结论随之失效
    currentInspection: null,
    confirmations: [],
    slotEntryIds: [],
    coating: null,
    archivedCount: 0,
  };
  db.plates.push(plate);
  addHistory(db, plate, "建档", "玻璃板档案建立 v1", at);
  return plate;
}

// 2. 旧底片交付登记：划痕、乳剂残留、清洗人；任一缺陷不合格只留待复洗
export function registerDelivery(db, code, input = {}, at) {
  const plate = mustFind(db, code);
  const allowed = [STATUS.PENDING_DELIVERY, STATUS.REWASH, STATUS.ROLLED_BACK];
  if (!allowed.includes(plate.status)) {
    throw new RuleError(
      "invalid_state",
      `当前状态「${plate.status}」不能登记旧底片交付`
    );
  }
  const cleaner = (input.cleaner || "").trim();
  if (!cleaner) throw new RuleError("missing_cleaner", "清洗人必填");
  const scratchResult = normalizeResult(input.scratchResult, "划痕判定");
  const residueResult = normalizeResult(input.residueResult, "乳剂残留判定");
  const deliveredAt = ts(at);

  // 复洗后重新交付：上一轮记录归档留档，结论失效重算
  if (plate.currentInspection) {
    archiveRound(db, plate, "旧底片重新交付，上一轮回用结论失效重算", deliveredAt);
  }
  plate.epoch += 1;
  plate.currentInspection = {
    deliveredAt,
    cleaner,
    scratch: (input.scratch || "").trim() || (scratchResult === PASS ? SCRATCH_PASS_NOTE : ""),
    scratchResult,
    residue: (input.residue || "").trim() || (residueResult === PASS ? RESIDUE_PASS_NOTE : ""),
    residueResult,
  };
  plate.confirmations = [];
  plate.status = hasDefect(plate.currentInspection)
    ? STATUS.REWASH
    : STATUS.AWAIT_CONFIRM;
  addHistory(
    db,
    plate,
    "交付登记",
    `旧底片交付登记：清洗人 ${cleaner}；划痕${scratchResult}；乳剂残留${residueResult}；` +
      (plate.status === STATUS.REWASH ? "缺陷未达标，留待复洗，不占用涂布槽" : "等待另一人两次表面洁净确认"),
    deliveredAt
  );
  return plate;
}

// 3. 回用前由另一人（非清洗人）连续两次确认表面洁净，间隔四小时
export function addCleanConfirmation(db, code, input = {}, at) {
  const plate = mustFind(db, code);
  if (!plate.currentInspection) {
    throw new RuleError("no_inspection", "尚未登记旧底片交付，无法确认表面洁净");
  }
  if (plate.status !== STATUS.AWAIT_CONFIRM) {
    throw new RuleError("invalid_state", `当前状态「${plate.status}」不能确认表面洁净`);
  }
  const inspector = (input.inspector || "").trim();
  if (!inspector) throw new RuleError("missing_inspector", "确认人必填");
  if (inspector === plate.currentInspection.cleaner) {
    throw new RuleError("same_person", "表面洁净确认必须由清洗人之外的另一人完成");
  }
  const atIso = ts(at);
  if (t(atIso) < t(plate.currentInspection.deliveredAt)) {
    throw new RuleError("bad_time", "确认时间不能早于旧底片交付登记时间");
  }
  const prev = plate.confirmations[plate.confirmations.length - 1];
  if (prev && t(atIso) - t(prev.at) < CONFIRM_INTERVAL_MS) {
    throw new RuleError(
      "interval_too_short",
      `两次表面洁净确认间隔须满四小时（上次确认 ${prev.at}，确认人 ${prev.inspector}）`
    );
  }
  plate.confirmations.push({ at: atIso, inspector });
  if (plate.confirmations.length >= CONFIRM_REQUIRED_TIMES) {
    plate.status = STATUS.READY;
    addHistory(
      db,
      plate,
      "回用结论",
      `另一人 ${inspector} 完成第 ${plate.confirmations.length} 次表面洁净确认；连续两次合格，准予回用并进入待涂布队列`,
      atIso
    );
  } else {
    addHistory(
      db,
      plate,
      "洁净确认",
      `另一人 ${inspector} 完成第 ${plate.confirmations.length} 次表面洁净确认，间隔四小时后需再次确认`,
      atIso
    );
  }
  return plate;
}

// 4. 旧底片状态回退：结论失效重算，旧记录留档
export function rollbackDelivery(db, code, input = {}, at) {
  const plate = mustFind(db, code);
  const allowed = [STATUS.REWASH, STATUS.AWAIT_CONFIRM, STATUS.READY];
  if (!allowed.includes(plate.status)) {
    throw new RuleError("invalid_state", `当前状态「${plate.status}」不能回退旧底片`);
  }
  const atIso = ts(at);
  archiveRound(db, plate, "旧底片状态回退，回用结论失效重算", atIso);
  plate.epoch += 1;
  plate.status = STATUS.ROLLED_BACK;
  addHistory(db, plate, "旧底片回退", (input.reason || "").trim() || "旧底片状态回退", atIso);
  return plate;
}

// 5. 玻璃板档案更正：旧记录留档，回用结论失效重算
export function correctPlate(db, code, input = {}, at) {
  const plate = mustFind(db, code);
  if (plate.status === STATUS.COATING || plate.status === STATUS.COATED) {
    throw new RuleError("invalid_state", "已进入涂布流程的玻璃板档案不可更正");
  }
  const changes = [];
  for (const key of ["plateSize", "source", "note"]) {
    if (input[key] !== undefined && String(input[key]) !== plate[key]) {
      changes.push({ key, from: plate[key], to: String(input[key]) });
      plate[key] = String(input[key]);
    }
  }
  if (!changes.length) throw new RuleError("no_change", "没有需要更正的档案字段");

  const atIso = ts(at);
  if (plate.currentInspection) {
    invalidateConclusion(db, plate, "玻璃板档案更正，回用结论失效重算", atIso);
  }
  plate.version += 1;
  plate.epoch += 1;
  if (plate.currentInspection) {
    plate.status = hasDefect(plate.currentInspection) ? STATUS.REWASH : STATUS.AWAIT_CONFIRM;
  }
  addHistory(
    db,
    plate,
    "档案更正",
    `档案更正至 v${plate.version}：` +
      changes.map((c) => `${c.key}「${c.from}」→「${c.to}」`).join("；") +
      (plate.currentInspection ? "；旧确认记录归档，回用结论失效重算" : ""),
    atIso
  );
  return plate;
}

// 6. 准予回用后占用涂布槽（只有 READY 能进入涂布槽）
export function occupyCoatingSlot(db, code, input = {}, at) {
  const plate = mustFind(db, code);
  if (plate.status !== STATUS.READY) {
    throw new RuleError("not_admitted", `状态「${plate.status}」未准予回用，不能占用涂布槽`);
  }
  const slot = (input.slot || "").trim();
  if (!slot) throw new RuleError("missing_slot", "涂布槽必填");
  if (!COATING_SLOTS.includes(slot)) {
    throw new RuleError("bad_slot", `涂布槽必须是：${COATING_SLOTS.join("、")}`);
  }
  const busy = db.slots.find((s) => s.slot === slot && s.releasedAt === null);
  if (busy) {
    throw new RuleError("slot_busy", `涂布槽已被玻璃板 ${busy.plateCode} 占用`);
  }
  const atIso = ts(at);
  const entry = {
    id: "S-" + ++db.seq,
    plateCode: plate.code,
    slot,
    occupiedAt: atIso,
    releasedAt: null,
  };
  db.slots.push(entry);
  plate.slotEntryIds.push(entry.id);
  plate.coating = { slotEntryId: entry.id, slot, occupiedAt: atIso };
  plate.status = STATUS.COATING;
  addHistory(db, plate, "占用涂布槽", `准予回用后占用 ${slot}，开始二次涂布`, atIso);
  return plate;
}

// 7. 二次涂布完成：释放涂布槽
export function completeCoating(db, code, input = {}, at) {
  const plate = mustFind(db, code);
  if (plate.status !== STATUS.COATING) {
    throw new RuleError("invalid_state", `当前状态「${plate.status}」尚未占用涂布槽`);
  }
  const atIso = ts(at);
  const entry = db.slots.find((s) => s.id === plate.coating.slotEntryId && s.releasedAt === null);
  if (entry) entry.releasedAt = atIso;
  addHistory(db, plate, "二次涂布完成", `完成二次涂布，释放 ${plate.coating.slot}`, atIso);
  plate.coating = null;
  plate.status = STATUS.COATED;
  return plate;
}

// 统一视图：列表 / 待涂布队列 / 玻璃板履历都从这一份状态渲染，保证刷新后一致
export function snapshot(db) {
  const plates = db.plates.map((p) => {
    const view = structuredClone(p);
    const conclusion = deriveConclusion(p);
    view.conclusion = conclusion.key;
    view.admitted = conclusion.admitted;
    return view;
  });
  const stats = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const p of plates) stats[p.status] += 1;
  return {
    plates,
    coatingQueue: plates.filter((p) => p.status === STATUS.READY),
    activeSlots: db.slots
      .filter((s) => s.releasedAt === null)
      .map((s) => structuredClone(s)),
    history: structuredClone(db.history).reverse(),
    archives: structuredClone(db.archives).reverse(),
    stats,
    constants: {
      statuses: STATUSES,
      results: RESULTS,
      slots: COATING_SLOTS,
      confirmRequiredTimes: CONFIRM_REQUIRED_TIMES,
      confirmIntervalHours: CONFIRM_INTERVAL_MS / 3_600_000,
      scratchPassNote: SCRATCH_PASS_NOTE,
      residuePassNote: RESIDUE_PASS_NOTE,
    },
  };
}

export function emptyDb() {
  return { seq: 0, plates: [], slots: [], history: [], archives: [] };
}
