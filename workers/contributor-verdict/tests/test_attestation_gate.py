import importlib.util,json,pathlib,unittest,tempfile
from unittest.mock import patch
p=pathlib.Path(__file__).parents[1]/'tools/verify_execution.py';spec=importlib.util.spec_from_file_location('gate',p);gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class GateTest(unittest.TestCase):
 def setUp(self):
  self.req={'schema_version':1,'job_id':1,'repository':'nvq2309/therascals','pull_request':1,'merge_sha':'a'*40,'beneficiary':'alice.testnet','worker_code_hash':'b'*64,'rubric_hash':'c'*64,'max_score':100};self.out={**self.req,'score':50,'eligible':True};self.res={'status':'completed','call_id':'11111111-1111-1111-1111-111111111111','attestation_url':'/attestations/by-call/11111111-1111-1111-1111-111111111111','output':self.out}
 def test_missing_attestation_is_unproven(self):
  del self.res['attestation_url']
  with self.assertRaises(ValueError):gate.check_response(self.req,self.res)
 def test_replayed_or_tampered_job_is_refused(self):
  self.out['job_id']=2
  with self.assertRaises(ValueError):gate.check_response(self.req,self.res)
 def test_score_cap_is_enforced(self):
  self.out['score']=101
  with self.assertRaises(ValueError):gate.check_response(self.req,self.res)
 def test_expected_evidence_is_only_prevalidated_not_certified(self):
  cid,_,_=gate.check_response(self.req,self.res);self.assertEqual(cid,self.res['call_id']);self.assertEqual(gate.wasm_hashes({'record':{'wasm_hash':'b'*64}}),['b'*64]);self.assertEqual(gate.wasm_hashes({'verified':True}),[])
 def test_missing_independent_verifier_fails_closed(self):
  with tempfile.TemporaryDirectory() as d:
   i=pathlib.Path(d)/'input.json';r=pathlib.Path(d)/'response.json';i.write_text(json.dumps(self.req));r.write_text(json.dumps(self.res))
   with patch('sys.argv',['verify_execution.py','--input',str(i),'--response',str(r),'--verifier','/nonexistent/independent-verifier']):
    with self.assertRaisesRegex(ValueError,'verifier unavailable'):gate.main()
if __name__=='__main__':unittest.main()
