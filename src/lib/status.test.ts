import test from "node:test";
import assert from "node:assert/strict";
import { parseStatus } from "./types";

test("parseStatus maps short Thai/English labels to existing statuses", () => {
  assert.equal(parseStatus("แย่"), "Very Poor");
  assert.equal(parseStatus("แย่มาก"), "Very Poor");
  assert.equal(parseStatus(" Poor "), "Very Poor");
  assert.equal(parseStatus("นัดปรึกษา"), "Appointment Booked");
  assert.equal(parseStatus("ไม่ตอบ"), "Not Responded");
  assert.equal(parseStatus("???"), undefined);
});
