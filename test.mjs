// 业务规则端到端测试：node test.mjs
import assert from "node:assert/strict";
import {
  emptyDb,
  createPlate,
  registerDelivery,
  addCleanConfirmation,
  rollbackDelivery,
  correctPlate,
  occupyCoatingSlot,
  completeCoating,
  snapshot,
  deriveConclusion,
  RuleError,
  STATUS,
} from "./rules.js";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const T0 = new Date("2026-09-22T08:00:00Z").getTime();
const at = (h) => new Date(T0 + h * 3600_000).toISOString();
let n = 0;
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);
function rejects(fn, code, name) {
  assert.throws(fn, (e) => e instanceof RuleError && e.code === code);
  ok(name + `（拒绝：${code}）`);
}

let db = emptyDb();

// 1. 建档
let p = createPlate(db, { code: "T-001", plateSize: "18x24cm", source: "批次甲" }, at(0));
assert.equal(p.status, STATUS.PENDING_DELIVERY);
assert.equal(p.epoch, 0);
ok("新建玻璃板为「待登记交付」，结论轮次 epoch=0");

// 2. 缺清洗人/判定非法
rejects(() => registerDelivery(db, "T-001", { scratchResult: "合格", residueResult: "合格" }, at(1)), "missing_cleaner", "登记缺清洗人");
rejects(() => registerDelivery(db, "T-001", { cleaner: "阿秀", scratchResult: "还行", residueResult: "合格" }, at(1)), "bad_result", "划痕判定必须合格/不合格");

// 3. 合格交付 → 待洁净确认
p = registerDelivery(db, "T-001", { cleaner: "阿秀", scratchResult: "合格", residueResult: "合格" }, at(1));
assert.equal(p.status, STATUS.AWAIT_CONFIRM);
assert.equal(p.epoch, 1);
assert.equal(deriveConclusion(p).admitted, false);
ok("两项缺陷均合格 → 待洁净确认，尚未进入涂布队列");

// 4. 洁净确认必须不是清洗人
rejects(() => addCleanConfirmation(db, "T-001", { inspector: "阿秀" }, at(2)), "same_person", "清洗人不能确认");

// 5. 第一次确认
p = addCleanConfirmation(db, "T-001", { inspector: "阿禾" }, at(2));
assert.equal(p.confirmations.length, 1);
assert.equal(p.status, STATUS.AWAIT_CONFIRM);
ok("另一人第一次确认通过，仍需第二次");

// 6. 间隔不足四小时
rejects(() => addCleanConfirmation(db, "T-001", { inspector: "阿禾" }, at(5.5)), "interval_too_short", "间隔不足四小时");

// 7. 满四小时第二次确认 → 准予回用
p = addCleanConfirmation(db, "T-001", { inspector: "阿禾" }, at(6));
assert.equal(p.status, STATUS.READY);
assert.equal(deriveConclusion(p).admitted, true);
const snap1 = snapshot(db);
assert.deepEqual(snap1.coatingQueue.map((x) => x.code), ["T-001"]);
ok("间隔满四小时第二次确认 → 准予回用，进入待涂布队列");

// 8. 划痕不合格 → 只留待复洗，不占用涂布槽
createPlate(db, { code: "T-002" }, at(0));
p = registerDelivery(db, "T-002", { cleaner: "阿秀", scratchResult: "不合格", scratch: "深划痕0.1mm", residueResult: "合格" }, at(1));
assert.equal(p.status, STATUS.REWASH);
assert.equal(deriveConclusion(p).admitted, false);
assert.equal(snapshot(db).coatingQueue.some((x) => x.code === "T-002"), false);
rejects(() => occupyCoatingSlot(db, "T-002", { slot: "涂布槽1号" }, at(2)), "not_admitted", "待复洗不能占用涂布槽");
rejects(() => addCleanConfirmation(db, "T-002", { inspector: "阿禾" }, at(2)), "invalid_state", "待复洗不能做洁净确认");
ok("任一缺陷未达标只留待复洗，不占涂布槽、不能确认");

// 9. 乳剂残留不合格同样待复洗
createPlate(db, { code: "T-003" }, at(0));
p = registerDelivery(db, "T-003", { cleaner: "阿石", scratchResult: "合格", residueResult: "不合格" }, at(1));
assert.equal(p.status, STATUS.REWASH);
ok("乳剂残留不合格同样待复洗");

// 10. 占用涂布槽
p = occupyCoatingSlot(db, "T-001", { slot: "涂布槽1号" }, at(7));
assert.equal(p.status, STATUS.COATING);
rejects(() => occupyCoatingSlot(db, "T-001", { slot: "涂布槽2号" }, at(7.1)), "not_admitted", "涂布中不能重复占槽");
// 另一块已准予回用的玻璃板不能再用同一槽
createPlate(db, { code: "T-004" }, at(0));
registerDelivery(db, "T-004", { cleaner: "阿石", scratchResult: "合格", residueResult: "合格" }, at(0.5));
addCleanConfirmation(db, "T-004", { inspector: "阿禾" }, at(1));
addCleanConfirmation(db, "T-004", { inspector: "阿禾" }, at(5.1));
rejects(() => occupyCoatingSlot(db, "T-004", { slot: "涂布槽1号" }, at(7.2)), "slot_busy", "已占用的槽不可重复占用");
p = occupyCoatingSlot(db, "T-004", { slot: "涂布槽2号" }, at(7.3));
assert.equal(p.status, STATUS.COATING);
ok("只有准予回用可占槽；槽位互斥，空槽可继续占用");

// 11. 完成涂布释放槽
p = completeCoating(db, "T-001", {}, at(9));
assert.equal(p.status, STATUS.COATED);
assert.equal(p.coating, null);
const released = db.slots.find((s) => s.plateCode === "T-001");
assert.ok(released.releasedAt);
ok("完成二次涂布并释放涂布槽");

// 12. 旧底片状态回退 → 结论失效重算、旧记录留档
createPlate(db, { code: "T-005" }, at(0));
registerDelivery(db, "T-005", { cleaner: "阿秀", scratchResult: "合格", residueResult: "合格" }, at(1));
addCleanConfirmation(db, "T-005", { inspector: "阿禾" }, at(2));
addCleanConfirmation(db, "T-005", { inspector: "阿禾" }, at(6.1));
assert.equal(db.plates.find((x) => x.code === "T-005").status, STATUS.READY);
const archBefore = db.archives.length;
p = rollbackDelivery(db, "T-005", { reason: "交付单填错" }, at(10));
assert.equal(p.status, STATUS.ROLLED_BACK);
assert.equal(p.currentInspection, null);
assert.equal(p.confirmations.length, 0);
assert.equal(db.archives.length, archBefore + 1);
assert.equal(deriveConclusion(p).admitted, false);
ok("旧底片回退：准予回用结论失效，检验/确认记录归档留档");

// 13. 回退后重新交付 = 新一轮
p = registerDelivery(db, "T-005", { cleaner: "阿石", scratchResult: "合格", residueResult: "合格" }, at(11));
assert.equal(p.epoch, 3);
assert.equal(p.status, STATUS.AWAIT_CONFIRM);
ok("回退后重新交付开启新一轮（epoch 前进），需重新两次确认");

// 14. 档案更正 → 结论失效重算、旧确认归档；缺陷事实保留
p = correctPlate(db, "T-005", { plateSize: "24x30cm" }, at(11.5));
assert.equal(p.version, 2);
assert.equal(p.currentInspection.cleaner, "阿石"); // 检验事实保留
assert.equal(p.confirmations.length, 0);
assert.equal(p.status, STATUS.AWAIT_CONFIRM);
assert.equal(deriveConclusion(p).admitted, false);
const a = db.archives[db.archives.length - 1];
assert.equal(a.inspection.cleaner, "阿石");
assert.equal(a.reason, "玻璃板档案更正，回用结论失效重算");
ok("档案更正：结论失效重算，检验事实保留、确认重做，旧记录留档");

// 15. 更正待复洗板：仍待复洗
createPlate(db, { code: "T-006" }, at(0));
registerDelivery(db, "T-006", { cleaner: "阿秀", scratchResult: "不合格", residueResult: "不合格" }, at(1));
p = correctPlate(db, "T-006", { source: "批次乙" }, at(2));
assert.equal(p.status, STATUS.REWASH);
assert.equal(p.version, 2);
ok("更正待复洗板后结论重算仍为待复洗");

// 16. 涂布中的板禁止档案更正
rejects(() => correctPlate(db, "T-004", { note: "x" }, at(8)), "invalid_state", "涂布中不可更正档案");

// 17. 复洗后重新交付：上一轮归档，合格则重新进入确认
p = registerDelivery(db, "T-002", { cleaner: "阿石", scratchResult: "合格", scratch: "复洗后无深划痕", residueResult: "合格" }, at(20));
assert.equal(p.status, STATUS.AWAIT_CONFIRM);
assert.equal(p.archivedCount >= 1, true);
ok("复洗后重新交付：不合格旧记录归档，合格后重新走两次确认");

// 18. 重复建档沿用首次结果
const before = db.plates.length;
const dup = createPlate(db, { code: "T-001", plateSize: "99x99cm" }, at(0));
assert.equal(db.plates.length, before);
assert.equal(dup.plateSize, "18x24cm");
ok("重复建档沿用首次结果");

// 19. 履历流水完整
const types = db.history.map((h) => h.type);
for (const t of ["建档", "交付登记", "洁净确认", "回用结论", "占用涂布槽", "二次涂布完成", "旧底片回退", "档案更正"]) {
  assert.ok(types.includes(t), `履历缺少 ${t}`);
}
ok("玻璃板履历覆盖全部业务动作");

// 20. 统一快照：列表/队列/统计口径一致
const snap = snapshot(db);
assert.equal(snap.plates.length, db.plates.length);
assert.deepEqual(snap.coatingQueue, snap.plates.filter((x) => x.status === STATUS.READY));
assert.equal(Object.values(snap.stats).reduce((a, b) => a + b, 0), db.plates.length);
ok("快照：列表、待涂布队列、统计来自同一重算口径");

console.log(`\n规则层 ${n} 项断言全部通过`);

// 21. 记录层：重复/并发 requestId 沿用首次结果
process.env.GP_DB_FILE = "glass-plate-recovery.test.json";
await import("./records.js").then(async ({ store, actions }) => {
  await store.init();
  actions.createPlate({ code: "C-001" }, at(0), "r1");
  // 同一 requestId 重复登记：只应有一次 epoch 前进
  await Promise.all([
    actions.registerDelivery("C-001", { cleaner: "阿秀", scratchResult: "合格", residueResult: "合格" }, at(1), "dup"),
    actions.registerDelivery("C-001", { cleaner: "别人", scratchResult: "不合格", residueResult: "不合格" }, at(2), "dup"),
  ]);
  const db2 = await store.read();
  const c1 = db2.plates.find((x) => x.code === "C-001");
  assert.equal(c1.epoch, 1, "并发同 requestId 只生效一次");
  assert.equal(c1.currentInspection.cleaner, "阿秀", "沿用首次结果（清洗人）");
  assert.equal(c1.status, STATUS.AWAIT_CONFIRM);
  ok("记录层：重复/并发请求沿用首次结果");

  // 落盘恢复
  await store.init();
  const db3 = await store.read();
  assert.equal(db3.plates.find((x) => x.code === "C-001").currentInspection.cleaner, "阿秀");
  ok("记录层：结果已落盘，重载一致");
});

rmSync(join(__dirname, "data", process.env.GP_DB_FILE), { force: true });
console.log("全部测试通过，临时测试数据已清理");
