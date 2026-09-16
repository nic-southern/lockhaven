"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import { organizationRoles, type OrganizationRole } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

const roleOptions = organizationRoles.map((role) => ({
  value: role,
  label: role.charAt(0).toUpperCase() + role.slice(1),
}))

function mappingToLines(values: Record<string, { organizationRole?: string }>) {
  return Object.entries(values)
    .map(([group, assignment]) =>
      assignment.organizationRole
        ? `${group}=${assignment.organizationRole}`
        : ""
    )
    .filter(Boolean)
    .join("\n")
}

function linesToMapping(value: string) {
  const values: Record<string, { organizationRole: OrganizationRole }> = {}
  for (const line of value.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const [group, role] = trimmed.split("=").map((part) => part.trim())
    if (!group || !role) {
      continue
    }
    if ((organizationRoles as readonly string[]).includes(role)) {
      values[group] = { organizationRole: role as OrganizationRole }
    }
  }
  return values
}

export default function SsoSettingsPage() {
  const { can, isLoading } = usePermissions()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const organizations = organizationsQuery.data ?? []
  const [organizationId, setOrganizationId] = React.useState("")
  const selectedOrganizationId = organizationId || organizations[0]?.id || ""

  const detailQuery = trpc.sso.get.useQuery(
    { organizationId: selectedOrganizationId },
    { enabled: Boolean(selectedOrganizationId) }
  )
  const upsert = trpc.sso.upsert.useMutation()

  const settings = detailQuery.data?.settings
  const platform = detailQuery.data?.platform

  const [enabled, setEnabled] = React.useState(false)
  const [required, setRequired] = React.useState(false)
  const [trustIdpMfa, setTrustIdpMfa] = React.useState(false)
  const [usePlatformIdp, setUsePlatformIdp] = React.useState(true)
  const [protocol, setProtocol] = React.useState<"oidc" | "saml">("oidc")
  const [allowedDomains, setAllowedDomains] = React.useState("")
  const [defaultRole, setDefaultRole] =
    React.useState<OrganizationRole>("technician")
  const [claim, setClaim] = React.useState("groups")
  const [mapping, setMapping] = React.useState("")
  const [issuer, setIssuer] = React.useState("")
  const [discoveryUrl, setDiscoveryUrl] = React.useState("")
  const [clientId, setClientId] = React.useState("")
  const [clientSecret, setClientSecret] = React.useState("")
  const [samlEntryPoint, setSamlEntryPoint] = React.useState("")
  const [samlCertificate, setSamlCertificate] = React.useState("")
  const [samlAudience, setSamlAudience] = React.useState("")
  const [samlMetadataXml, setSamlMetadataXml] = React.useState("")

  React.useEffect(() => {
    if (!settings) {
      return
    }
    setEnabled(settings.enabled)
    setRequired(settings.required)
    setTrustIdpMfa(settings.trustIdpMfa)
    setUsePlatformIdp(settings.usePlatformIdp)
    setProtocol(settings.protocol)
    setAllowedDomains(settings.allowedDomains.join(", "))
    setDefaultRole(settings.defaultOrganizationRole)
    setClaim(settings.claimsMap.claim || "groups")
    setMapping(mappingToLines(settings.claimsMap.values))
    setIssuer(settings.issuer ?? "")
    setDiscoveryUrl(settings.discoveryUrl ?? "")
    setClientId(settings.clientId ?? "")
    setClientSecret("")
    setSamlEntryPoint(settings.samlEntryPoint ?? "")
    setSamlCertificate(settings.samlCertificate ?? "")
    setSamlAudience(settings.samlAudience ?? "")
    setSamlMetadataXml(settings.samlMetadataXml ?? "")
  }, [settings])

  if (isLoading || organizationsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!can("organization:admin")) {
    return (
      <EmptyState
        title="You don't have access"
        description="Ask an administrator if you need to change sign-in settings."
      />
    )
  }

  if (!selectedOrganizationId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          badge="Settings"
          title="Single sign-on"
          description="Let people sign in with your organization's identity provider."
        />
        <EmptyState
          title="No organization yet"
          description="Create an organization before turning on single sign-on."
        />
      </div>
    )
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    try {
      await upsert.mutateAsync({
        organizationId: selectedOrganizationId,
        enabled,
        required,
        protocol,
        usePlatformIdp,
        allowedDomains: allowedDomains
          .split(/[,\s]+/)
          .map((part) => part.trim())
          .filter(Boolean),
        trustIdpMfa,
        claimsMap: {
          claim: claim.trim() || "groups",
          values: linesToMapping(mapping),
        },
        defaultOrganizationRole: defaultRole,
        issuer: issuer || null,
        discoveryUrl: discoveryUrl || null,
        clientId: clientId || null,
        clientSecret: clientSecret || null,
        samlEntryPoint: samlEntryPoint || null,
        samlCertificate: samlCertificate || null,
        samlAudience: samlAudience || null,
        samlMetadataXml: samlMetadataXml || null,
      })
      setClientSecret("")
      toast.success("Sign-in settings saved.")
    } catch {
      toast.error("We couldn't save those settings.")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Settings"
        title="Single sign-on"
        description="People sign in with your identity provider. Disable an account here and in the identity provider when someone leaves."
      />

      {organizations.length > 1 ? (
        <FormField label="Organization" htmlFor="sso-org">
          <SelectField
            id="sso-org"
            value={selectedOrganizationId}
            onValueChange={setOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
          />
        </FormField>
      ) : null}

      {detailQuery.isLoading || !settings ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <form className="flex flex-col gap-6" onSubmit={handleSave}>
          <SectionCard
            title="Sign-in"
            description="When SSO is required, passwords and passkeys are turned off for matching email domains. If the identity provider is unreachable, sign-in stays closed."
            collapsibleOnMobile
            defaultOpenOnMobile
          >
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Enable SSO</p>
                  <p className="text-sm text-muted-foreground">
                    Show Sign in with SSO for this organization.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Require SSO</p>
                  <p className="text-sm text-muted-foreground">
                    Matching users must use SSO. Local sign-in is blocked.
                  </p>
                </div>
                <Switch checked={required} onCheckedChange={setRequired} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">
                    Trust the identity provider
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Skip the in-app authenticator step when the identity
                    provider already verified the person.
                  </p>
                </div>
                <Switch
                  checked={trustIdpMfa}
                  onCheckedChange={setTrustIdpMfa}
                />
              </div>
              <FormField
                label="Allowed email domains"
                htmlFor="sso-domains"
                description="Only addresses on these domains can join through SSO."
              >
                <Input
                  id="sso-domains"
                  value={allowedDomains}
                  onChange={(event) => setAllowedDomains(event.target.value)}
                  placeholder="example.com"
                />
              </FormField>
              <FormField label="Default role" htmlFor="sso-role">
                <SelectField
                  id="sso-role"
                  value={defaultRole}
                  onValueChange={(value) =>
                    setDefaultRole(value as OrganizationRole)
                  }
                  options={roleOptions}
                />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard
            title="Role mapping"
            description="Map identity-provider groups to organization roles. One group per line, for example operators=operator."
            collapsibleOnMobile
          >
            <div className="flex flex-col gap-5">
              <FormField label="Group attribute" htmlFor="sso-claim">
                <Input
                  id="sso-claim"
                  value={claim}
                  onChange={(event) => setClaim(event.target.value)}
                  placeholder="groups"
                />
              </FormField>
              <FormField label="Mappings" htmlFor="sso-mapping">
                <Textarea
                  id="sso-mapping"
                  value={mapping}
                  onChange={(event) => setMapping(event.target.value)}
                  placeholder={"operators=operator\ntechnicians=technician"}
                />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard
            title="Identity provider"
            description="Use the company sign-in service, or connect this organization's own provider."
            collapsibleOnMobile
          >
            <div className="flex flex-col gap-5">
              {platform?.enabled ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  Company sign-in is ready.
                  <Badge variant="secondary">Connected</Badge>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Company sign-in is not configured on this host yet.
                </p>
              )}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Use company sign-in</p>
                  <p className="text-sm text-muted-foreground">
                    Recommended. Uses the shared identity provider.
                  </p>
                </div>
                <Switch
                  checked={usePlatformIdp}
                  onCheckedChange={setUsePlatformIdp}
                />
              </div>
              {!usePlatformIdp ? (
                <>
                  <FormField label="Protocol" htmlFor="sso-protocol">
                    <SelectField
                      id="sso-protocol"
                      value={protocol}
                      onValueChange={(value) =>
                        setProtocol(value as "oidc" | "saml")
                      }
                      options={[
                        { value: "oidc", label: "OpenID" },
                        { value: "saml", label: "SAML" },
                      ]}
                    />
                  </FormField>
                  <FormField label="Issuer" htmlFor="sso-issuer">
                    <Input
                      id="sso-issuer"
                      value={issuer}
                      onChange={(event) => setIssuer(event.target.value)}
                    />
                  </FormField>
                  {protocol === "oidc" ? (
                    <>
                      <FormField label="Discovery URL" htmlFor="sso-discovery">
                        <Input
                          id="sso-discovery"
                          value={discoveryUrl}
                          onChange={(event) =>
                            setDiscoveryUrl(event.target.value)
                          }
                        />
                      </FormField>
                      <FormField label="Client ID" htmlFor="sso-client-id">
                        <Input
                          id="sso-client-id"
                          value={clientId}
                          onChange={(event) => setClientId(event.target.value)}
                          autoComplete="off"
                        />
                      </FormField>
                      <FormField
                        label="Client secret"
                        htmlFor="sso-client-secret"
                        description={
                          settings.hasClientSecret
                            ? "Leave blank to keep the saved secret."
                            : undefined
                        }
                      >
                        <Input
                          id="sso-client-secret"
                          type="password"
                          value={clientSecret}
                          onChange={(event) =>
                            setClientSecret(event.target.value)
                          }
                          autoComplete="new-password"
                          placeholder={
                            settings.hasClientSecret ? "••••••••" : undefined
                          }
                        />
                      </FormField>
                    </>
                  ) : (
                    <>
                      <FormField label="Sign-in URL" htmlFor="sso-entry">
                        <Input
                          id="sso-entry"
                          value={samlEntryPoint}
                          onChange={(event) =>
                            setSamlEntryPoint(event.target.value)
                          }
                        />
                      </FormField>
                      <FormField label="Certificate" htmlFor="sso-cert">
                        <Textarea
                          id="sso-cert"
                          value={samlCertificate}
                          onChange={(event) =>
                            setSamlCertificate(event.target.value)
                          }
                        />
                      </FormField>
                      <FormField label="Audience" htmlFor="sso-audience">
                        <Input
                          id="sso-audience"
                          value={samlAudience}
                          onChange={(event) =>
                            setSamlAudience(event.target.value)
                          }
                        />
                      </FormField>
                      <FormField
                        label="Provider metadata"
                        htmlFor="sso-metadata"
                      >
                        <Textarea
                          id="sso-metadata"
                          value={samlMetadataXml}
                          onChange={(event) =>
                            setSamlMetadataXml(event.target.value)
                          }
                        />
                      </FormField>
                      {settings.spAcsUrl ? (
                        <p className="text-sm text-muted-foreground">
                          Assertion consumer URL: {settings.spAcsUrl}
                        </p>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
            </div>
          </SectionCard>

          <div className="flex justify-end">
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
