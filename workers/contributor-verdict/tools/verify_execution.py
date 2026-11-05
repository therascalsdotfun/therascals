#!/usr/bin/env python3
"""Fail closed for a hosted HTTP output without independently verified attestation.
No payout/signing. Keeps the exact input/output bytes passed to the verifier.
"""
import argparse,hashlib,json,pathlib,re,subprocess,sys

def check_response(request, response):
    if response.get('status')!='completed':raise ValueError('execution is not completed')
    cid=response.get('call_id','')
    if not re.fullmatch(r'[0-9a-fA-F-]{36}',cid):raise ValueError('invalid call identifier')
    if response.get('attestation_url')!=f'/attestations/by-call/{cid}':raise ValueError('execution has no bound attestation record')
    output=response.get('output');text=output if isinstance(output,str) else json.dumps(output,separators=(',',':'))
    out=json.loads(text)
    if not isinstance(out,dict):raise ValueError('worker output is not an object')
    for key in ['schema_version','job_id','repository','pull_request','merge_sha','beneficiary','worker_code_hash','rubric_hash']:
        if out.get(key)!=request.get(key):raise ValueError('worker request binding mismatch: '+key)
    if not isinstance(out.get('score'),int) or isinstance(out['score'],bool) or not 0<=out['score']<=request['max_score']:raise ValueError('score exceeds authorized policy')
    if not out.get('eligible') and out['score']!=0:raise ValueError('ineligible result has nonzero score')
    return cid,text,out

def wasm_hashes(node):
    found=[]
    if isinstance(node,dict):
        for k,v in node.items():
            if k in ['wasm_hash','wasmHash','wasm_sha256','wasmSha256'] and isinstance(v,str):found.append(v)
            found.extend(wasm_hashes(v))
    elif isinstance(node,list):
        for v in node:found.extend(wasm_hashes(v))
    return found

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--response',type=pathlib.Path,required=True);p.add_argument('--verifier',default='outlayer-verify');p.add_argument('--network',choices=['testnet'],default='testnet');a=p.parse_args()
    raw=a.input.read_text().strip();request=json.loads(raw);response=json.loads(a.response.read_text());cid,output,verdict=check_response(request,response)
    # The independent CLI verifies Intel/DCAP, approved measurements and exact call bytes.
    try:r=subprocess.run([a.verifier,'call',cid,'--network',a.network,'--input',raw,'--output',output,'--json'],capture_output=True,text=True,timeout=120)
    except (FileNotFoundError,subprocess.TimeoutExpired):raise ValueError('attestation verifier unavailable; output remains unproven')
    if r.returncode!=0:raise ValueError('attestation verification failed or could not complete')
    try:proof=json.loads(r.stdout)
    except ValueError:raise ValueError('attestation verifier did not return structured proof')
    hashes=wasm_hashes(proof)
    if not hashes or any(h!=request['worker_code_hash'] for h in hashes):raise ValueError('proof does not establish the expected WASM hash; output remains unproven')
    print(json.dumps({'verified':True,'call_id':cid,'verdict':verdict},indent=2))
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,TypeError) as e:print('UNPROVEN: '+str(e),file=sys.stderr);sys.exit(2)
