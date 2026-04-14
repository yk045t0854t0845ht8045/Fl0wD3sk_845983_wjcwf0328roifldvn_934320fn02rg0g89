import { NextResponse } from "next/server";
import { checkDomains } from "@/lib/openprovider/domains";

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[Domains API][${requestId}] Request received`);

  try {
    const { domain } = await req.json();
    const baseName = domain.split(".")[0].toLowerCase();
    
    if (!baseName) {
      return NextResponse.json({ ok: false, message: "Nome de domínio inválido" }, { status: 400 });
    }

    const tlds = ["com.br", "com", "ai", "io", "org"];
    const domainsToCheck = tlds.map(tld => ({ name: baseName, extension: tld }));

    console.log(`[Domains API][${requestId}] Checking domains: ${baseName}.[${tlds.join(',')}]`);
    
    const results = await checkDomains(domainsToCheck);

    console.log(`[Domains API][${requestId}] Success`);
    return NextResponse.json({ ok: true, results });

  } catch (error: any) {
    console.error(`[Domains API][${requestId}] API Error:`, error.message);
    
    // Check for specific error messages or codes if needed
    if (error.message.includes("timed out")) {
      return NextResponse.json({ ok: false, message: "O provedor de domínios demorou muito para responder (Timeout)." }, { status: 504 });
    }

    return NextResponse.json({ 
      ok: false, 
      message: error.message || "Erro interno na comunicação com o provedor."
    }, { status: 500 });
  }
}
