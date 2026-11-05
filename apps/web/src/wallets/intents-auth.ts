import bs58 from "bs58";

export type IntentsSessionChallenge = {
  id: string;
  payload: string;
  address: string;
  expiresAt: string;
};

/** Only sign the precise, empty ownership intent, never arbitrary server intents. */
export async function signIntentsSession(
  provider: any,
  challenge: IntentsSessionChallenge,
  address: string,
  current: () => boolean,
) {
  const check = () => {
    if (!current() || provider?.publicKey?.toString() !== address)
      throw new Error(
        "Wallet changed. Verify the original Phantom account again.",
      );
  };
  check();
  const p = JSON.parse(challenge.payload),
    deadline = Date.parse(p.deadline);
  if (
    challenge.address !== address ||
    !/^[a-f0-9]{64}$/.test(challenge.id) ||
    Object.keys(p).sort().join(",") !==
      "deadline,intents,nonce,signer_id,verifying_contract" ||
    p.signer_id !==
      Array.from(bs58.decode(address), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("") ||
    p.verifying_contract !== "intents.near" ||
    !Array.isArray(p.intents) ||
    p.intents.length !== 0 ||
    typeof p.nonce !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/.test(p.nonce) ||
    !Number.isFinite(deadline) ||
    deadline !== Date.parse(challenge.expiresAt) ||
    deadline <= Date.now() ||
    deadline > Date.now() + 150000
  )
    throw new Error(
      "Unexpected Confidential Intents ownership message. Nothing was signed.",
    );
  const result = await provider.signMessage(
    new TextEncoder().encode(challenge.payload),
    "utf8",
  );
  check();
  if (
    !(result?.signature instanceof Uint8Array) ||
    result.signature.length !== 64 ||
    (result.publicKey && result.publicKey.toString() !== address)
  )
    throw new Error("Phantom returned an unexpected signature.");
  return bs58.encode(result.signature);
}
