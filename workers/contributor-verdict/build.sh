#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cargo build --manifest-path "$HERE/Cargo.toml" --locked --release --target wasm32-wasip2
mkdir -p "$HERE/artifacts"
python3 - "$HERE" <<'PY'
import hashlib,json,pathlib,shutil,sys
p=pathlib.Path(sys.argv[1]);source=p/'target/wasm32-wasip2/release/contributor-verdict.wasm';h=hashlib.sha256(source.read_bytes()).hexdigest();out=p/'artifacts'/f'{h}.wasm';shutil.copy2(source,out);x={'wasm_sha256':h,'rubric_hash':hashlib.sha256((p/'rubric.json').read_bytes()).hexdigest(),'target':'wasm32-wasip2','repository':'nvq2309/therascals','artifact':out.name};(p/'artifacts/build.json').write_text(json.dumps(x,indent=2));print(json.dumps(x,indent=2))
PY
