import type { MetadataRoute } from "next";

/** Lets Palk be added to a phone's Home Screen (needed on iPhone for calls to ring while Palk is closed). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Palk",
    short_name: "Palk",
    description: "End-to-end encrypted messages and calls with everyone on Pacewise.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0C0F",
    theme_color: "#0B7F79",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
