import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Input, Button, Badge, Label, Switch } from "@medusajs/ui"
import { useEffect, useState } from "react"

type Settings = {
  ucp_enabled: boolean
  acp_enabled: boolean
  store_name: string
  store_description: string
  storefront_url: string
  // Secrets are NOT returned by GET — only previews and flags
  api_key: string // Only holds new user-entered values
  signature_key: string // Only holds new user-entered values
  api_key_preview?: string | null
  signature_key_preview?: string | null
  has_api_key?: boolean
  has_signature_key?: boolean
}

type SettingsResponse = {
  settings: Settings
  store_id: string
  payment_handlers: { count: number; connected: boolean }
}

type TestResult = {
  endpoint: string
  status: number | null
  ok: boolean
  detail?: string
}

const SettingsPage = () => {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSignatureKey, setShowSignatureKey] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    fetch("/admin/agentic-commerce/settings", { credentials: "include" })
      .then((res) => res.json())
      .then((json: SettingsResponse) => {
        setData(json)
        // GET doesn't return secrets — init form with empty strings for key fields
        setForm({ ...json.settings, api_key: "", signature_key: "" })
      })
      .catch(() => {})
  }, [])

  const updateField = (field: keyof Settings, value: string | boolean) => {
    if (!form) return
    setForm({ ...form, [field]: value })
    setSaved(false)
  }

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    try {
      // Only send fields that should be persisted; exclude preview/flag fields
      // Only include secrets if the user actually entered new values
      const { api_key_preview, signature_key_preview, has_api_key, has_signature_key, ...base } = form
      const settingsToSave: Record<string, unknown> = { ...base }
      if (!settingsToSave.api_key) delete settingsToSave.api_key
      if (!settingsToSave.signature_key) delete settingsToSave.signature_key
      const res = await fetch("/admin/agentic-commerce/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsToSave),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      // Error handling
    } finally {
      setSaving(false)
    }
  }

  const generateKey = (field: "api_key" | "signature_key") => {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const key = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("")
    updateField(field, key)
    if (field === "api_key") setShowApiKey(true)
    if (field === "signature_key") setShowSignatureKey(true)
  }

  const runTest = async (protocol: "ucp" | "acp") => {
    setTesting(true)
    setTestResult(null)
    const endpoint = protocol === "ucp" ? "/.well-known/ucp" : "/.well-known/acp.json"
    try {
      const res = await fetch(endpoint)
      const json = await res.json()
      const handlerCount = protocol === "ucp"
        ? Object.values(json?.ucp?.payment_handlers || {}).flat().length
        : (json?.capabilities?.payment?.handlers || []).length
      setTestResult({
        endpoint,
        status: res.status,
        ok: res.ok,
        detail: `${res.status} OK — ${handlerCount} payment handler${handlerCount !== 1 ? "s" : ""}`,
      })
    } catch {
      setTestResult({ endpoint, status: null, ok: false, detail: "Connection failed" })
    } finally {
      setTesting(false)
    }
  }

  if (!form || !data) {
    return (
      <Container>
        <Text>Loading settings...</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <Heading level="h1" className="mb-1">Agentic Commerce Settings</Heading>
        <Text className="text-ui-fg-subtle">
          Configure how AI agents interact with your store.
        </Text>
      </Container>

      {/* Protocol Status */}
      <Container>
        <Heading level="h2" className="mb-3">Protocol Status</Heading>
        <div className="flex gap-6">
          <div className="flex items-center gap-3">
            <Switch
              checked={form.ucp_enabled}
              onCheckedChange={(checked) => updateField("ucp_enabled", checked)}
            />
            <Label>UCP</Label>
            <Badge color={form.ucp_enabled ? "green" : "grey"}>
              {form.ucp_enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.acp_enabled}
              onCheckedChange={(checked) => updateField("acp_enabled", checked)}
            />
            <Label>ACP</Label>
            <Badge color={form.acp_enabled ? "green" : "grey"}>
              {form.acp_enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </div>
      </Container>

      {/* Store Profile */}
      <Container>
        <Heading level="h2" className="mb-3">Store Profile</Heading>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="store_name">Store Name</Label>
            <Input
              id="store_name"
              value={form.store_name}
              onChange={(e) => updateField("store_name", e.target.value)}
              placeholder="Your Store Name"
            />
          </div>
          <div>
            <Label htmlFor="store_description">Description</Label>
            <Input
              id="store_description"
              value={form.store_description}
              onChange={(e) => updateField("store_description", e.target.value)}
              placeholder="What your store sells"
            />
          </div>
          <div>
            <Label htmlFor="storefront_url">Storefront URL</Label>
            <Input
              id="storefront_url"
              value={form.storefront_url}
              onChange={(e) => updateField("storefront_url", e.target.value)}
              placeholder="https://your-store.com"
            />
          </div>
        </div>
      </Container>

      {/* Authentication */}
      <Container>
        <Heading level="h2" className="mb-3">Authentication</Heading>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="api_key">ACP API Key</Label>
            <div className="flex gap-2">
              <Input
                id="api_key"
                type={showApiKey ? "text" : "password"}
                value={form.api_key || ""}
                onChange={(e) => updateField("api_key", e.target.value)}
                placeholder={data.settings.api_key_preview || (data.settings.has_api_key ? "••••••••" : "Not set")}
                className="flex-1 font-mono"
              />
              <Button
                variant="secondary"
                size="small"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? "Hide" : "Show"}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => generateKey("api_key")}
              >
                Regenerate
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="signature_key">HMAC Secret</Label>
            <div className="flex gap-2">
              <Input
                id="signature_key"
                type={showSignatureKey ? "text" : "password"}
                value={form.signature_key || ""}
                onChange={(e) => updateField("signature_key", e.target.value)}
                placeholder={data.settings.signature_key_preview || (data.settings.has_signature_key ? "••••••••" : "Not set")}
                className="flex-1 font-mono"
              />
              <Button
                variant="secondary"
                size="small"
                onClick={() => setShowSignatureKey(!showSignatureKey)}
              >
                {showSignatureKey ? "Hide" : "Show"}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => generateKey("signature_key")}
              >
                Regenerate
              </Button>
            </div>
          </div>
        </div>
      </Container>

      {/* Payment Handlers */}
      <Container>
        <Heading level="h2" className="mb-3">Payment Handlers</Heading>
        {data.payment_handlers.connected ? (
          <div className="flex items-center gap-2">
            <Badge color="green">Connected</Badge>
            <Text>
              {data.payment_handlers.count} payment handler{data.payment_handlers.count !== 1 ? "s" : ""} registered
            </Text>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge color="orange">Not Connected</Badge>
            <Text className="text-ui-fg-subtle">
              No payment handlers registered. Configure a payment handler adapter in your Medusa config.
            </Text>
          </div>
        )}
      </Container>

      {/* Quick Test */}
      <Container>
        <Heading level="h2" className="mb-3">Quick Test</Heading>
        <div className="flex gap-2 mb-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => runTest("ucp")}
            disabled={testing}
          >
            Test UCP Discovery
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => runTest("acp")}
            disabled={testing}
          >
            Test ACP Discovery
          </Button>
        </div>
        {testResult && (
          <div className="flex items-center gap-2">
            <Badge color={testResult.ok ? "green" : "red"}>
              {testResult.ok ? "OK" : "Failed"}
            </Badge>
            <Text size="small" className="text-ui-fg-subtle">
              {testResult.detail}
            </Text>
          </div>
        )}
      </Container>

      {/* Save */}
      <Container>
        <div className="flex items-center justify-end gap-3">
          {saved && (
            <Badge color="green">Settings saved</Badge>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Agentic Commerce",
})

export default SettingsPage
