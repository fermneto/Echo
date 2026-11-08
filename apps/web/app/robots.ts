import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Só a landing é pública: o painel fica fora dos buscadores. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/landing", disallow: "/" }, sitemap: `${siteUrl()}/sitemap.xml` };
}
