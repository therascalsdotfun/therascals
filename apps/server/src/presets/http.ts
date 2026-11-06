import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import type { WalletAuthService } from "../auth/service.ts";
import { subjectFor } from "../beta/access.ts";
import { CommunityPresets, PresetError } from "./service.ts";
export function registerCommunityPresets(app: FastifyInstance, presets: CommunityPresets | undefined, identity: (req:any)=>WalletIdentity|null, auth:WalletAuthService) {
  const handle=(work:(req:any,user:WalletIdentity|null)=>unknown)=>async(req:any,reply:any)=>{
    try{
      if(!presets)throw new PresetError("Community presets are unavailable on this server.",503);
      const user=identity(req);
      auth.rate("presets:"+(user?subjectFor(user):req.ip),req.method==="GET"?60:10);
      if(req.method!=="GET"&&!user)throw new PresetError("Connect and verify your wallet to publish a preset.",401);
      return work(req,user);
    }catch(e){if(e instanceof PresetError)return reply.code(e.status).send({error:e.message});throw e;}
  };
  app.get("/api/presets",handle((req,user)=>{
    const q=z.object({
      mine:z.enum(["true","false"]).optional(),
      sort:z.enum(["recent","popular","trades"]).optional(),
      q:z.string().max(80).optional(),
      limit:z.coerce.number().int().min(1).max(100).optional(),
      offset:z.coerce.number().int().min(0).optional(),
    }).strict().safeParse(req.query);
    if(!q.success)throw new PresetError("Invalid preset query.");
    return presets!.list(user??undefined,{
      mine:q.data.mine==="true",
      sort:q.data.sort,
      search:q.data.q,
      limit:q.data.limit,
      offset:q.data.offset,
    });
  }));
  app.get("/api/presets/:id",handle((req)=>{
    if(!z.string().uuid().safeParse(req.params.id).success)throw new PresetError("Invalid preset identifier.",400);
    return presets!.get(req.params.id);
  }));
  app.post("/api/presets",handle((req,user)=>{
    const body=z.object({requestId:z.string().uuid(),title:z.string().min(1).max(60),code:z.string().min(1).max(14000)}).strict().safeParse(req.body);
    if(!body.success)throw new PresetError("Check the preset name and Degen Code.");
    try{return presets!.publish(user!,body.data);}catch(e){if(e instanceof PresetError)throw e;throw new PresetError("Check the Degen Code before publishing.");}
  }));
  app.post("/api/presets/:id/unpublish",handle((req,user)=>{
    if(!z.string().uuid().safeParse(req.params.id).success || Object.keys(req.body??{}).length)throw new PresetError("Invalid preset request.");
    return presets!.unpublish(user!,req.params.id);
  }));
}
