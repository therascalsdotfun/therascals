import { createHash, randomBytes } from "node:crypto";
/**
 * A roll is committed before anyone learns its winner. The server holds the
 * seed, publishes only the commitment, and the cage animation is driven by that
 * commitment. Revealing the seed afterwards lets every participant recompute
 * the same winner, so neither the client nor the server can pick it after the
 * commitment is public.
 */
export const ROLL_LABEL = "JACKPOT_ROLL_V1";
export const ROLL_POOL_MIN = 2;
export const ROLL_POOL_MAX = 32;
const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest();
const ordered = (poolKeys: string[]) => [...poolKeys].sort();
export const newRollSeed = () => randomBytes(32).toString("hex");
function assertRoll(
  seed: string,
  configurationHash: string,
  poolKeys: string[],
) {
  if (!/^[0-9a-f]{64}$/.test(seed))
    throw Error("Roll seed must be 32 hex bytes");
  if (!/^[0-9a-f]{64}$/.test(configurationHash))
    throw Error("Roll needs the frozen configuration hash");
  const keys = ordered(poolKeys);
  if (
    keys.length < ROLL_POOL_MIN ||
    keys.length > ROLL_POOL_MAX ||
    new Set(keys).size !== keys.length
  )
    throw Error("Roll pool must hold 2-32 distinct tokens");
  if (keys.some((key) => !key.length || key.length > 120))
    throw Error("Roll pool key is out of range");
  return keys;
}
/**
 * Every roll value, including the published commitment, comes from a distinct
 * domain of the seed. Deriving a sample from the commitment instead would let
 * anyone read the winner from the commitment alone, since it is public.
 */
function rollDigest(
  seed: string,
  configurationHash: string,
  keys: string[],
  label: string,
) {
  if (!label) throw Error("Roll digest needs a label");
  return sha(
    `${ROLL_LABEL}|${label}|${seed}|${configurationHash}|${keys.join(",")}`,
  );
}
/** Binds the seed to one frozen configuration and one exact token set. */
export function rollCommitment(
  seed: string,
  configurationHash: string,
  poolKeys: string[],
) {
  const keys = assertRoll(seed, configurationHash, poolKeys);
  return rollDigest(seed, configurationHash, keys, "commitment").toString(
    "hex",
  );
}
const SPAN = 0x1_0000_0000;
/**
 * Uniform integer in [0, span) drawn from the seed. Values at the top of the
 * 32-bit range are rejected so an uneven span cannot bias the result, which is
 * how the contract's own draw sampler stays fair. `label` keeps each use of a
 * seed independent, so the winning token and the degen amount never correlate.
 */
export function rollScalar(
  seed: string,
  configurationHash: string,
  poolKeys: string[],
  label: string,
  span: number,
) {
  const keys = assertRoll(seed, configurationHash, poolKeys);
  if (!Number.isInteger(span) || span < 1 || span > SPAN)
    throw Error("Roll scalar span is out of range");
  const bucket = Math.floor(SPAN / span) * span;
  let digest = rollDigest(seed, configurationHash, keys, `scalar:${label}`);
  for (let guard = 0; guard < 64; guard++) {
    const value = digest.readUInt32BE(0);
    if (value < bucket) return value % span;
    digest = sha(digest);
  }
  throw Error("Roll sampling failed to terminate");
}
export function rollWinner(
  seed: string,
  configurationHash: string,
  poolKeys: string[],
) {
  const keys = assertRoll(seed, configurationHash, poolKeys);
  return keys[rollScalar(seed, configurationHash, keys, "winner", keys.length)];
}
/** Recomputes from the revealed seed; a swapped seed never matches. */
export function verifyRollReveal(
  commitment: string,
  seed: string,
  configurationHash: string,
  poolKeys: string[],
) {
  try {
    return rollCommitment(seed, configurationHash, poolKeys) === commitment;
  } catch {
    return false;
  }
}
