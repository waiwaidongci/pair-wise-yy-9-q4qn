// 玻璃板回收与二次涂布准入台 —— 业务规则
// 纯函数：缺陷准入判定、双确认规则、状态机、档案更正/状态回退后的失效重算。

export const PLATE_STATUS = {
  PENDING_INTAKE: "待登记",
  REWASH: "待复洗",
  AWAIT_CONFIRM: "待复认",
  READY: "待涂布",
  COATED: "已涂布",
};
export const plateStatuses = Object.values(PLATE_STATUS);

export const NEGATIVE_STATUS = ["待曝光", "冲洗中", "待入盒", "已交付", "已回退"];

// 三项验收：任一缺陷未达标准 -> 只留待复洗，不能占用涂布槽
export const ACCEPTANCE = {
  scratch: {
    label: "划痕",
    pass: ["无", "无划痕"],
    standard: "无划痕",
    ok: (v) => typeof v === "string" && ["无", "无划痕"].includes(v.trim()),
  },
  emulsion: {
    label: "乳剂残留",
    pass: ["无", "无残留"],
    standard: "无乳剂残留",
    ok: (v) => typeof v === "string" && ["无", "无残留"].includes(v.trim()),
  },
  cleaner: {
    label: "清洗人",
    standard: "登记清洗人",
    ok: (v) => typeof v === "string" && v.trim().length > 0,
  },
};
export const CONFIRM_INTERVAL_MS = 4 * 60 * 60 * 1000; // 两次确认间隔四小时
export const CONFIRM_TIMES = 2; // 回用前连续两次确认表面洁净

export function isIntakePassed(intake) {
  if (!intake) return false;
  return (
    ACCEPTANCE.scratch.ok(intake.scratch) &&
    ACCEPTANCE.emulsion.ok(intake.emulsion) &&
    ACCEPTANCE.cleaner.ok(intake.cleaner)
  );
}

export function defectSummary(intake) {
  if (!intake) return "尚未登记划痕、乳剂残留和清洗人";
  const bad = [];
  if (!ACCEPTANCE.scratch.ok(intake.scratch)) bad.push(`划痕不达标（${intake.scratch || "未登记"}）`);
  if (!ACCEPTANCE.emulsion.ok(intake.emulsion)) bad.push(`乳剂残留不达标（${intake.emulsion || "未登记"}）`);
  if (!ACCEPTANCE.cleaner.ok(intake.cleaner)) bad.push("未登记清洗人");
  return bad.length ? bad.join("；") : "三项均达标";
}

// 仅"全部达标"才从待复洗/待复认推进，任何缺陷都挡在涂布槽外
export function nextStatusAfterIntake(plate) {
  return isIntakePassed(plate.intake) ? PLATE_STATUS.AWAIT_CONFIRM : PLATE_STATUS.REWASH;
}

// 清洁确认校验：回用前由"另一人"连续两次确认，第二次距第一次满四小时
export function checkClean(plate, input, now = Date.now()) {
  if (plate.status !== PLATE_STATUS.AWAIT_CONFIRM) {
    return { ok: false, error: `当前为「${plate.status}」，不能登记洁净确认` };
  }
  const confirmer = (input.confirmer || "").trim();
  if (!confirmer) return { ok: false, error: "请填写确认人" };
  const cleaner = (plate.intake?.cleaner || "").trim();
  if (cleaner && confirmer === cleaner) {
    return { ok: false, error: "回用确认必须由清洗人之外的另一人完成" };
  }
  const sameRevision = (plate.cleanChecks || []).filter((c) => c.revision === plate.revision);
  if (sameRevision.length === 0) {
    return { ok: true, seq: 1, at: input.at || now };
  }
  if (sameRevision.length === 1) {
    if (sameRevision[0].confirmer === confirmer) {
      return { ok: false, error: "两次确认须由不同人员完成" };
    }
    const at = input.at || now;
    if (new Date(at).getTime() - new Date(sameRevision[0].at).getTime() < CONFIRM_INTERVAL_MS) {
      return { ok: false, error: "第二次确认距第一次不足四小时" };
    }
    return { ok: true, seq: 2, at };
  }
  return { ok: false, error: "两次洁净确认已完成" };
}

// 洁净确认是否在当前版本连续两次完成
export function cleanConfirmed(plate) {
  const sameRevision = (plate.cleanChecks || []).filter((c) => c.revision === plate.revision);
  if (sameRevision.length < CONFIRM_TIMES) return false;
  const [first, second] = sameRevision;
  return new Date(second.at).getTime() - new Date(first.at).getTime() >= CONFIRM_INTERVAL_MS;
}

export function canCoat(plate) {
  return plate.status === PLATE_STATUS.READY && cleanConfirmed(plate);
}

// 玻璃板档案更正 / 旧底片状态回退：回用结论失效并重算，旧记录留档由调用方归档。
// 重算只依据本版本最新登记：达标 -> 待复认（清空本版本确认，需重新两人两认）；
// 任一缺陷未达标 -> 待复洗，绝不占用涂布槽。
export function recalculate(plate, reason, at = new Date().toISOString()) {
  const previous = {
    status: plate.status,
    revision: plate.revision,
    intake: plate.intake ? { ...plate.intake } : null,
    cleanChecks: (plate.cleanChecks || []).map((c) => ({ ...c })),
  };
  plate.revision = (plate.revision || 1) + 1;
  plate.invalidatedAt = at;
  plate.status = nextStatusAfterIntake(plate);
  plate.history ||= [];
  plate.history.push({
    at,
    type: "invalidate",
    reason,
    fromRevision: previous.revision,
    toRevision: plate.revision,
    fromStatus: previous.status,
    toStatus: plate.status,
    detail: defectSummary(plate.intake),
    superseded: previous, // 旧结论随旧记录留档，不删除
  });
  return plate;
}
