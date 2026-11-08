import type { MetadataRoute } from "next";
import { ROUTES } from "@/lib/access";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Só a página inicial é pública: o painel fica fora dos buscadores. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/$", disallow: [...Object.values(ROUTES).map((r) => r.href), "/entrar", "/api/"] }, sitemap: `${siteUrl()}/sitemap.xml` };
}
