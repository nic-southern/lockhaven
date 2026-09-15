"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { CodeBlock } from "@/components/dashboard/code-block"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import {
  buildAndroidInstallCommand,
  buildLinuxInstallCommand,
  buildWindowsInstallCommand,
} from "@/lib/enrollment-commands"
import { getClientProductName, getClientVpnBaseUrl } from "@/lib/product-name"
import { trpc } from "@/lib/trpc"

const ENROLLMENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function EnrollDeviceCard({ onClose }: { onClose?: () => void }) {
  const utils = trpc.useUtils()
  const productName = getClientProductName()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()

  const [siteId, setSiteId] = React.useState("")
  // `null` means the user hasn't chosen, so the organization default applies.
  const [chosenRoutePolicyId, setChosenRoutePolicyId] = React.useState<
    string | null
  >(null)
  const [reusable, setReusable] = React.useState(false)
  const [token, setToken] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const createOrganization = trpc.organizations.create.useMutation({
    onSuccess() {
      void utils.organizations.list.invalidate()
    },
  })
  const createToken = trpc.enrollmentTokens.create.useMutation()

  const sites = sitesQuery.data ?? []
  const selectedSite = sites.find((site) => site.id === siteId)
  const baseUrl = getClientVpnBaseUrl()
  const routePolicies = routePoliciesQuery.data ?? []
  const targetOrganizationId =
    selectedSite?.organizationId ?? organizationsQuery.data?.[0]?.id ?? null
  const defaultPolicy = routePolicies.find(
    (policy) =>
      policy.isDefault &&
      (policy.organizationId === null ||
        policy.organizationId === targetOrganizationId)
  )
  const routePolicyId = chosenRoutePolicyId ?? defaultPolicy?.id ?? ""

  async function handleCreate() {
    setError(null)
    try {
      let organizationId =
        selectedSite?.organizationId ?? organizationsQuery.data?.[0]?.id
      if (!organizationId) {
        const organization = await createOrganization.mutateAsync({
          name: productName,
        })
        organizationId = organization.id
      }
      const result = await createToken.mutateAsync({
        organizationId,
        siteId: siteId || null,
        siteWide: reusable,
        routePolicyId: routePolicyId || null,
        expiresAt: siteId
          ? new Date(Date.now() + ENROLLMENT_TOKEN_TTL_MS)
          : null,
        maxUses: 1,
      })
      setToken(result.token)
      toast.success("Enrollment token created")
    } catch {
      setError("We couldn't create an enrollment token.")
      toast.error("We couldn't create an enrollment token.")
    }
  }

  return (
    <Card className="border-border/80 shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Enroll a device</CardTitle>
          <CardDescription>
            Leave site empty for imaging tokens, then assign the location after
            install. Imaging tokens do not expire until revoked.
          </CardDescription>
        </div>
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <FormField
            label="Site"
            htmlFor="enroll-site"
            description="Optional for mass imaging."
          >
            <SelectField
              id="enroll-site"
              value={siteId}
              onValueChange={setSiteId}
              emptyLabel="No site (imaging)"
              disabled={sites.length === 0}
              options={sites.map((site) => ({
                value: site.id,
                label: site.name,
              }))}
            />
          </FormField>
          <FormField label="Route policy" htmlFor="enroll-route-policy">
            <SelectField
              id="enroll-route-policy"
              value={routePolicyId}
              onValueChange={setChosenRoutePolicyId}
              emptyLabel="No policy"
              options={routePolicies.map((policy) => ({
                value: policy.id,
                label: policy.isDefault
                  ? `${policy.name} (default)`
                  : policy.name,
              }))}
            />
          </FormField>
          <div className="flex items-center gap-2">
            <Checkbox
              id="enroll-reusable"
              checked={reusable}
              onCheckedChange={(checked) => setReusable(checked === true)}
            />
            <Label htmlFor="enroll-reusable" className="text-sm font-normal">
              Reusable shared token
            </Label>
          </div>
          {reusable ? (
            <p className="text-sm text-muted-foreground">
              Use the same token across many imaged devices until it expires or
              is revoked.
            </p>
          ) : null}
          <Button
            className="w-full sm:w-fit"
            onClick={() => void handleCreate()}
            disabled={createOrganization.isPending || createToken.isPending}
          >
            Create token
          </Button>
          {token ? <CodeBlock label="Enrollment token" value={token} /> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Run the installer</p>
            <p className="text-sm text-muted-foreground">
              Create a token, then run Windows or Linux on the device. Android
              runs on a workstation and imports the config into the tablet or
              phone.
            </p>
          </div>
          {token ? (
            <div className="flex flex-col gap-3">
              <CodeBlock
                label="Windows"
                value={buildWindowsInstallCommand({ token, baseUrl })}
              />
              <CodeBlock
                label="Linux"
                value={buildLinuxInstallCommand({ token, baseUrl })}
              />
              <CodeBlock
                label="Android"
                value={buildAndroidInstallCommand({ token, baseUrl })}
              />
            </div>
          ) : (
            <EmptyState
              title="No token yet"
              description="Installer commands appear after you create a token."
              bordered
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
