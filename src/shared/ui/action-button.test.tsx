// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionStatusResponse } from "../actions/action-types";
import { ActionButton } from "./action-button";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const button = () => screen.getByRole("button");

describe("ActionButton", () => {
  it("sends only once on a fast double click", async () => {
    const pending = deferred<{ trackingId: string }>();
    const onAccept = vi.fn(() => pending.promise);
    render(<ActionButton onAccept={onAccept}>Pagar</ActionButton>);

    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(button()).toHaveProperty("disabled", true);
    expect(button().textContent).toBe("Procesando…");

    await act(async () => pending.resolve({ trackingId: "t-1" }));
  });

  it("reuses the same key when retrying after a network error", async () => {
    const onAccept = vi
      .fn<(key: string) => Promise<{ trackingId: string }>>()
      .mockRejectedValueOnce(new Error("network_error"))
      .mockResolvedValueOnce({ trackingId: "t-1" });
    render(<ActionButton onAccept={onAccept}>Enviar</ActionButton>);

    fireEvent.click(button());
    await screen.findByText(/No pudimos enviar la solicitud/);
    expect(button()).toHaveProperty("disabled", false);

    fireEvent.click(button());
    await screen.findByText(/Recibido/);

    expect(onAccept).toHaveBeenCalledTimes(2);
    expect(onAccept.mock.calls[1]?.[0]).toBe(onAccept.mock.calls[0]?.[0]);
  });

  it("tracking mode: unlocks on tracking_id and uses a new key for a new intent", async () => {
    const onTracked = vi.fn();
    const onAccept = vi
      .fn<(key: string) => Promise<{ trackingId: string }>>()
      .mockResolvedValue({ trackingId: "t-1" });
    render(
      <ActionButton onAccept={onAccept} onTracked={onTracked}>
        Enviar
      </ActionButton>,
    );

    fireEvent.click(button());
    await screen.findByText(/Recibido/);
    expect(onTracked).toHaveBeenCalledWith("t-1");
    expect(button()).toHaveProperty("disabled", false);

    fireEvent.click(button());
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(2));
    expect(onAccept.mock.calls[1]?.[0]).not.toBe(onAccept.mock.calls[0]?.[0]);
  });

  it("completion mode: stays locked until the action finishes", async () => {
    // Each status read waits until the test answers it.
    const reads: ReturnType<typeof deferred<ActionStatusResponse>>[] = [];
    const getStatus = vi.fn(() => {
      const read = deferred<ActionStatusResponse>();
      reads.push(read);
      return read.promise;
    });
    const onFinished = vi.fn();
    render(
      <ActionButton
        mode="completion"
        onAccept={async () => ({ trackingId: "t-1" })}
        getStatus={getStatus}
        pollIntervalMs={5}
        onFinished={onFinished}
      >
        Pagar
      </ActionButton>,
    );

    fireEvent.click(button());
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    expect(button()).toHaveProperty("disabled", true);

    await act(async () =>
      reads[0]?.resolve({ trackingId: "t-1", status: "processing", retrying: false, result: null }),
    );
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
    expect(button()).toHaveProperty("disabled", true);

    await act(async () =>
      reads[1]?.resolve({ trackingId: "t-1", status: "queued", retrying: true, result: null }),
    );
    await screen.findByText("Procesando… reintentando");
    expect(button()).toHaveProperty("disabled", true);

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(3));
    await act(async () =>
      reads[2]?.resolve({ trackingId: "t-1", status: "succeeded", retrying: false, result: { ok: true } }),
    );
    await screen.findByText("Listo.");
    expect(button()).toHaveProperty("disabled", false);
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(onFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" }),
    );
  });

  it("completion mode: keeps waiting if reading the status fails once", async () => {
    const getStatus = vi
      .fn<(id: string) => Promise<ActionStatusResponse>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        trackingId: "t-1",
        status: "failed",
        retrying: false,
        result: null,
      });
    const onAccept = vi
      .fn<(key: string) => Promise<{ trackingId: string }>>()
      .mockResolvedValue({ trackingId: "t-1" });
    render(
      <ActionButton
        mode="completion"
        onAccept={onAccept}
        getStatus={getStatus}
        pollIntervalMs={5}
      >
        Pagar
      </ActionButton>,
    );

    fireEvent.click(button());
    await screen.findByText(/No se pudo completar/);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(button()).toHaveProperty("disabled", false);

    // A failed action ends the intent: trying again is a new intent.
    fireEvent.click(button());
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(2));
    expect(onAccept.mock.calls[1]?.[0]).not.toBe(onAccept.mock.calls[0]?.[0]);
  });
});
