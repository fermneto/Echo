import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canSee, navFor } from "@/lib/access";
import { lookFor } from "@/lib/demo/looks";
import { currentPersona, demoMode } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { MiniEcho } from "@/components/MiniEcho";
import { Nav } from "@/components/Nav";
import { NavProgress } from "@/components/NavProgress";
import { PageEnter } from "@/components/PageEnter";
import { sair } from "../entrar/actions";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const persona = await currentPersona();
  if (!persona) redirect("/entrar");
  const demo = demoMode();

  return (
    <>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <NavProgress />
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__row">
            <Logo href="/dashboard" />
            <div className="topbar__me">
              {canSee(persona.role, "plano", { demo }) && <MiniEcho personId={persona.id} look={persona.avatar ?? lookFor(persona.id)} />}
              <span className="topbar__name">{persona.name}</span>
              <form action={sair}>
                <button type="submit" className="link-button mono">
                  SAIR
                </button>
              </form>
            </div>
          </div>
          <Nav groups={navFor(persona.role, { demo })} />
        </div>
      </header>
      <main className="page" id="conteudo" tabIndex={-1}>
        <PageEnter>{children}</PageEnter>
      </main>
    </>
  );
}
