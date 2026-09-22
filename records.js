// 玻璃板回收与二次涂布准入台 —— 记录（持久化）业务文件
// 所有写操作经同一把链式锁串行落盘，读走同队列，避免并发覆盖。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyDb,
  createPlate,
  registerDelivery,
  addCleanConfirmation,
  rollbackDelivery,
  correctPlate,
  occupyCoatingSlot,
  completeCoating,
} from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.GP_DB_FILE || "glass-plate-recovery.json";
const dbPath = join(__dirname, "data", dbFile);

class JsonStore {
  constructor(path) {
    this.path = path;
    this.db = null;
    this.chain = Promise.resolve();
    this.idempotency = new Map(); // 进程内重复/并发请求沿用首次结果
  }

  async init() {
    if (!existsSync(this.path)) {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(buildSeed(), null, 2));
    }
    this.db = JSON.parse(await readFile(this.path, "utf8"));
    return this.db;
  }

  // 读也入队：永远读到一份已落盘的一致状态
  read() {
    return this.enqueue(() => structuredClone(this.db));
  }

  // 写串行化；同一 idempotencyKey 的重复/并发请求复用首个结果
  update(idempotencyKey, mutate) {
    return this.enqueue(() => {
      if (idempotencyKey) {
        const seen = this.idempotency.get(idempotencyKey);
        if (seen) return structuredClone(seen);
      }
      const result = mutate(this.db);
      return writeFile(this.path, JSON.stringify(this.db, null, 2)).then(() => {
        if (idempotencyKey) {
          this.idempotency.set(idempotencyKey, result);
          if (this.idempotency.size > 500) {
            this.idempotency.delete(this.idempotency.keys().next().value);
          }
        }
        return structuredClone(result);
      });
    });
  }

  enqueue(task) {
    const run = this.chain.then(task, task);
    // 防止单次失败中断后续队列
    this.chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }
}

export const store = new JsonStore(dbPath);

const H = (h, ms) => new Date(new Date("2026-09-20T08:00:00Z").getTime() + ms * 3_600_000).toISOString();

function buildSeed() {
  const db = emptyDb();
  // GP-101：两项缺陷均合格，已完成两次洁净确认，准予回用（待涂布队列）
  let p = createPlate(db, { code: "GP-101", plateSize: "18x24cm", source: "蓝晒旧底片批次甲", note: "边缘有旧标签残留痕迹" }, H(0, 0));
  registerDelivery(db, "GP-101", { cleaner: "阿秀", scratchResult: "合格", residueResult: "合格" }, H(0, 1));
  addCleanConfirmation(db, "GP-101", { inspector: "阿禾" }, H(0, 5));
  addCleanConfirmation(db, "GP-101", { inspector: "阿禾" }, H(0, 9.5));

  // GP-102：划痕未达标，只留待复洗，不能占用涂布槽
  p = createPlate(db, { code: "GP-102", plateSize: "24x30cm", source: "蓝晒旧底片批次乙" }, H(0, 0.2));
  registerDelivery(db, "GP-102", { cleaner: "阿秀", scratchResult: "不合格", scratch: "深划痕0.12mm", residueResult: "合格" }, H(0, 1.2));

  // GP-103：合格但只完成一次确认，等待四小时后第二次
  p = createPlate(db, { code: "GP-103", plateSize: "12x17cm", source: "蓝晒旧底片批次甲" }, H(0, 0.4));
  registerDelivery(db, "GP-103", { cleaner: "阿石", scratchResult: "合格", residueResult: "合格" }, H(0, 2));
  addCleanConfirmation(db, "GP-103", { inspector: "阿禾" }, H(0, 6));

  // GP-104：刚建档，待登记交付
  createPlate(db, { code: "GP-104", plateSize: "18x24cm", source: "蓝晒旧底片批次丙" }, H(0, 0.6));
  return db;
}

// 记录层动作：每个动作一个 idempotencyKey（客户端可传 requestId 防重复提交）
export const actions = {
  createPlate: (input, at, requestId) =>
    store.update(requestId && `create:${requestId}`, (db) => createPlate(db, input, at)),
  registerDelivery: (code, input, at, requestId) =>
    store.update(requestId && `delivery:${requestId}`, (db) => registerDelivery(db, code, input, at)),
  confirm: (code, input, at, requestId) =>
    store.update(requestId && `confirm:${requestId}`, (db) => addCleanConfirmation(db, code, input, at)),
  rollback: (code, input, at, requestId) =>
    store.update(requestId && `rollback:${requestId}`, (db) => rollbackDelivery(db, code, input, at)),
  correct: (code, input, at, requestId) =>
    store.update(requestId && `correct:${requestId}`, (db) => correctPlate(db, code, input, at)),
  occupy: (code, input, at, requestId) =>
    store.update(requestId && `occupy:${requestId}`, (db) => occupyCoatingSlot(db, code, input, at)),
  completeCoating: (code, input, at, requestId) =>
    store.update(requestId && `complete:${requestId}`, (db) => completeCoating(db, code, input, at)),
};
