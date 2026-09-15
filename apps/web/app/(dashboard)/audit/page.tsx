import { permanentRedirect } from "next/navigation"

/** The audit log moved to Activity; keep old bookmarks working. */
export default function AuditRedirectPage() {
  permanentRedirect("/activity")
}
