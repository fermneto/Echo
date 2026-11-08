import { echoAvatarResponse } from "@/lib/avatar";

/** Ícone do próprio Echo (avisos e respostas sem dono), no mesmo estilo dos gêmeos. */
export function GET(): Response {
  return echoAvatarResponse();
}
