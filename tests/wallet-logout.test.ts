import { expect, it, vi } from "vitest";
import { confirmLogout } from "../apps/web/src/wallets/logout.ts";
const signal = () => new AbortController().signal;
it("retries a transient network failure and requires a confirmed null identity", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(Response.json({ identity: null }));
  await confirmLogout(signal(), request);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
});
it("does not accept HTML or an authenticated response as sign-out", async () => {
  for (const response of [
    new Response("<html>proxy</html>"),
    Response.json({ identity: { address: "still-signed-in" } }),
    Response.json({}),
  ]) {
    await expect(
      confirmLogout(signal(), vi.fn().mockResolvedValue(response)),
    ).rejects.toMatchObject({ code: "LOGOUT_RESPONSE" });
  }
});
it("reports origin rejection without looping or bypassing the verification gate", async () => {
  const request = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
  await expect(confirmLogout(signal(), request)).rejects.toMatchObject({
    code: "LOGOUT_ORIGIN",
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it("limits transient server retries and keeps failure unconfirmed", async () => {
  const request = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
  await expect(confirmLogout(signal(), request)).rejects.toMatchObject({
    code: "LOGOUT_SERVER",
  });
  expect(request).toHaveBeenCalledTimes(2);
});
it("retains cancellation instead of issuing another logout request", async () => {
  const controller = new AbortController();
  const request = vi.fn().mockImplementation(() => {
    controller.abort(new Error("cancelled"));
    return Promise.reject(controller.signal.reason);
  });
  await expect(confirmLogout(controller.signal, request)).rejects.toThrow(
    "cancelled",
  );
  expect(request).toHaveBeenCalledTimes(1);
});
