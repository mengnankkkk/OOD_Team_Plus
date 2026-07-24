import { NextRequest, NextResponse } from "next/server";
import { getDatabase, meta } from "@/server/http/context";
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){const{id}=await params;const db=getDatabase();const row=db.prepare("SELECT * FROM instruments WHERE id=?").get(id) as Record<string,unknown>|undefined;db.close();if(!row)return NextResponse.json({error:{code:"RESOURCE_NOT_FOUND",message:"Instrument not found"}},{status:404});return NextResponse.json({data:row,meta:meta()});}
