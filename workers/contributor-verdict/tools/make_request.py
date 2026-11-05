#!/usr/bin/env python3
"""Print a pinned OutLayer request; never upload, pay or send a transaction."""
import argparse,hashlib,json,pathlib,urllib.parse
p=argparse.ArgumentParser();p.add_argument('job',type=pathlib.Path);p.add_argument('--wasm-url',required=True);p.add_argument('--secret-account');p.add_argument('--secret-profile');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];build=json.loads((root/'artifacts/build.json').read_text());job=json.loads(a.job.read_text());u=urllib.parse.urlparse(a.wasm_url)
if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or not u.path.endswith(build['wasm_sha256']+'.wasm'):p.error('Use a published HTTPS URL named by the actual WASM hash')
if bool(a.secret_account)!=bool(a.secret_profile):p.error('Secret account and profile must be configured together')
if a.secret_account and not a.secret_account.endswith('.testnet'):p.error('testnet secret account required')
allowed={'schema_version','job_id','repository','pull_request','merge_sha','beneficiary','worker_code_hash','rubric_hash','max_score'}
if set(job)-allowed:p.error('Unknown job fields refused; never put credentials in a job')
if job.get('repository')!='nvq2309/therascals':p.error('This worker is pinned to nvq2309/therascals')
job['schema_version']=1;job['worker_code_hash']=build['wasm_sha256'];job['rubric_hash']=build['rubric_hash']
secret={'profile':a.secret_profile,'account_id':a.secret_account} if a.secret_account else None
print(json.dumps({'source':{'WasmUrl':{'url':a.wasm_url,'hash':build['wasm_sha256'],'build_target':'wasm32-wasip2'}},'resource_limits':{'max_instructions':10000000000,'max_memory_mb':128,'max_execution_seconds':60},'input_data':json.dumps(job,separators=(',',':')),'secrets_ref':secret,'response_format':'Json','payer_account_id':None,'params':None},indent=2))
