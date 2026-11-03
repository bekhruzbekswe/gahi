# GAHI on native platforms

*Research as of 4 November 2026, from documentation only. Nothing was built or tested.*

## The answer

GAHI can work natively on all five platforms, but only in an app whose owner builds it in. Every operating system offers some way to declare actions. None offers drafts, an outbox, an undo-cost field, or an approval step an agent is barred from. The kit must supply those everywhere.

The platforms differ most on who may call an app. On macOS, Windows and Linux, an outside agent can reach a local MCP server that the app ships. On Android and iOS, the system route is reserved for system agents. Without the owner's help, an agent can only read and click through accessibility. That gives no real drafts, and Google Play bans it for autonomous agents.

The key finding is about approval. Leaving out an "approve" tool stops an agent that only has tools. It doesn't stop an agent with accessibility permission from pressing the Approve button on macOS, Windows or Linux. Hard-to-undo actions therefore need a biometric prompt that signs the exact draft. Where a server exists, it should make the final check: Microsoft says [the desktop client isn't a security boundary](https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/govern-agent-actions).

**Start with macOS.** The smallest useful prototype is about 2 to 3 weeks for one engineer.

*How to read this: a linked statement comes from that source. "Inference" marks my own reasoning. Sources for the table are in the sections below it.*

| | iOS | Android | macOS | Windows | Linux |
|---|---|---|---|---|---|
| **Action declaration** | App Intents shipped (iOS 16+); Siri tools in preview (27.3 beta) | AppFunctions in beta (Android 16+) | App Intents shipped (macOS 13+); Siri tools in preview (27.3 beta) | App Actions shipped (build 26100+); MCP registry prerelease (26220.7262+) | No agent API found; GAction and AT-SPI shipped |
| **Outside agent can call?** | No | No, except `adb` for testing | Yes, through the app's own MCP server | Yes, through MCP | Yes, through D-Bus or MCP |
| **Closeness to define-once** | Close | Medium | Close | Medium | Medium |
| **Strongest approval** | Face ID plus Secure Enclave key | Biometric plus Keystore key | Touch ID plus Secure Enclave key | Windows Hello signature | No standard |
| **Without the owner** | Nothing found | Accessibility, banned on Play for autonomous agents | Accessibility and screen capture, outside the sandbox | UI Automation, not elevated windows | AT-SPI and consent-gated portals |
| **Biggest blocker** | No outside-agent route | Caller permission is system-only | Accessibility can press Approve | Contained server can't reach the app | No standard approval or agent API |

## iOS

- **Declarations.** [App Intents](https://developer.apple.com/documentation/appintents) cover actions and content from iOS 16. [Schema domains](https://developer.apple.com/documentation/appintents/app-schema-domains) cover common actions; the older [assistant schema macros are deprecated](https://developer.apple.com/documentation/appintents/deprecated-symbols). Custom Siri tools are new: [`@AppIntent(.tool)`](https://developer.apple.com/documentation/appintents/bringing-custom-actions-and-content-to-siri) entered a [Developer Preview on 3 November](https://developer.apple.com/news/?id=gdk2umrf) in the 27.3 betas. App Store submission opens in spring, and [external testers can't use it](https://developer.apple.com/documentation/appintents/siri-ai-developer-preview). Linking views to entities gives Siri [onscreen context](https://developer.apple.com/documentation/appintents/apple-intelligence-and-siri-ai), the nearest thing to an agent view. The [Accessibility framework](https://developer.apple.com/documentation/accessibility) serves assistive technologies.
- **Define once.** See the macOS example. Intents [must be Swift, compiled into the app](https://docs.expo.dev/versions/latest/sdk/app-intents/).
- **Agent access.** Siri and Shortcuts only. I found no API for another app to call intents. [All third-party apps are sandboxed](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web), and Apple tells apps to [close listening sockets in the background](https://developer.apple.com/library/archive/technotes/tn2277/_index.html). Inference: a local MCP bridge isn't workable, so use an in-app agent or a remote relay.
- **Drafts.** Inference: use a [Core Data child context](https://developer.apple.com/documentation/coredata/nsmanagedobjectcontext/parent) or a SwiftData context with [autosave off](https://developer.apple.com/documentation/swiftdata/modelcontext/autosaveenabled), and draw the UI from it. Nothing is possible without the app's cooperation.
- **Approval.** [`requestConfirmation`](https://developer.apple.com/documentation/appintents/appintent/requestconfirmation%28conditions:actionname:dialog:%29) shows a prompt (this form, iOS 18+). [`authenticationPolicy`](https://developer.apple.com/documentation/appintents/intentauthenticationpolicy) can require unlock, but the [27.3 beta notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27_3-release-notes) say Siri may skip it for entities. Apple also says [ordering and paying make poor tools](https://developer.apple.com/documentation/appintents/toolintent), which suits GAHI's split between drafting and approving.
- **Without the owner.** I found no public route. This is an absence in the docs, not a stated rule.

## Android

- **Declarations.** [AppFunctions](https://developer.android.com/ai/appfunctions) run on Android 16+. The [library reached 1.0.0-beta01 on 21 October](https://developer.android.com/jetpack/androidx/releases/appfunctions), while the [platform package](https://developer.android.com/reference/android/app/appfunctions/package-summary) still says beta/experimental. Google's guide puts Gemini integration in [private preview as of May, with limited apps and agents](https://developer.android.com/ai/appfunctions) on the full pipeline. [App Actions](https://developer.android.com/guide/app-actions/overview) (`shortcuts.xml`, Android 5+) are built around Assistant launching app screens. Inference: they don't fit GAHI.
- **Define once.** Medium. A developer writes `@AppFunctionDeclaration(isDescribedByKDoc = true)` on a [Kotlin function](https://developer.android.com/agents/skills/device-ai/mlkit-agent-api/references/tools_and_functions), and the compiler generates the schema. Android 17 adds [runtime registration](https://developer.android.com/reference/android/app/appfunctions/package-summary), which suits availability. Inference: the kit must generate the Compose button and add undo cost itself.
- **Agent access.** The reference calls callers "system-privileged". AOSP marks [`EXECUTE_APP_FUNCTIONS`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/AndroidManifest.xml) as `internal|role`, and [AOSP's role list](https://android.googlesource.com/platform/packages/modules/Permission/+/refs/heads/main/PermissionController/res/xml/roles.xml) gives that family only to system roles. Testing works through [`adb shell cmd app_function`](https://developer.android.com/ai/appfunctions). [Access levels](https://developer.android.com/agents/skills/device-ai/mlkit-agent-api/references/tools_and_functions) can limit a function to the app itself, for an in-app agent ([ML Kit, alpha](https://developer.android.com/blog/posts/build-it-your-way-a-next-era-of-android-development)), or to named agent packages. Inference: a [bound service](https://developer.android.com/develop/background-work/services/aidl) could bridge a cooperating agent app, but that is custom work.
- **Drafts.** Inference: the function writes to a pending table and returns a draft ID. Google's skill says to [expose only safe, non-destructive tasks](https://github.com/android/skills/tree/main/device-ai/appfunctions). Inference: a third party's [user-granted overlay](https://developer.android.com/privacy-and-security/risks/tapjacking) only paints, and an app can hide it.
- **Approval.** External calls [bypass in-app confirmation wrappers](https://developer.android.com/agents/skills/device-ai/mlkit-agent-api/references/tools_and_functions), so functions must only create drafts. From Android 17 the [caller's package name is always empty](https://developer.android.com/reference/android/app/appfunctions/package-summary). Use [`BiometricPrompt` with an auth-per-use key](https://developer.android.com/identity/sign-in/biometric-auth). [`accessibilityDataSensitive`](https://developer.android.com/privacy-and-security/risks/tapjacking) blocks reading and pressing by anything that isn't a declared accessibility tool (Android 14+; gestures from 16). This is the best button-level defence I found on any platform.
- **Without the owner.** An [accessibility service](https://developer.android.com/guide/topics/ui/accessibility/service) can read and act once enabled. [Sideloaded apps face restricted settings](https://support.google.com/android/answer/12623953?hl=en), and [Advanced Protection](https://support.google.com/android/answer/16339980?hl=en) allows only verified tools. [Play prohibits](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en) using it to "autonomously initiate, plan, and execute actions". [Computer Control](https://developer.android.com/ai/computer-control) is a preview for OEM-preloaded assistants only.

## macOS

- **Declarations.** Same App Intents, from macOS 13, with the same preview. Apple's documented MCP use is [Xcode's bridge for coding agents](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode). Accessibility is [`AXUIElement`](https://developer.apple.com/documentation/applicationservices/axuielement_h).
- **Define once.** The closest of the five. SwiftUI already has [`Button(intent:)`](https://developer.apple.com/documentation/swiftui/button/init%28intent:label:%29) (macOS 14+), but the [system context](https://developer.apple.com/documentation/appintents/intentsystemcontext) lists no caller identity. Inference: `perform()` can't tell a person from an agent, so the kit needs its own button. A developer might write this (`GahiAction` and `GahiButton` don't exist yet):

```swift
@AppIntent(.tool)                              // Apple, preview
struct ArchiveInvoice: AppIntent, GahiAction { // GahiAction: kit protocol
    static let title: LocalizedStringResource = "Archive invoice"
    static let undoCost = UndoCost.easy
    @Parameter(title: "Invoice") var invoice: InvoiceEntity
    func isAvailable(in s: AppState) -> Bool { s[invoice.id]?.isOpen == true }
    func apply(to s: AppState) -> AppState { s.archiving(invoice.id) } // pure change
    // the kit's default perform() writes a draft instead of committing
}
GahiButton(ArchiveInvoice(invoice: entity)) // commits directly for the person
```

- **Agent access.** I found no documented way for an outside agent to call App Intents. The [`shortcuts` command](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac) runs shortcuts, not intents directly. Inference: the app should host its own MCP server. Sandboxed apps may [listen with an entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server). Any local process can reach a localhost port, so the kit needs a per-agent token.
- **Drafts.** As on iOS. Inference: without the owner, an overlay window can paint over an app but can't hold or apply its state.
- **Approval.** Use [biometrics-only authentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthenticationwithbiometrics) with a [key tied to current biometrics](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset) to sign a hash of the draft. I found no equivalent of Android's sensitive flag. Inference: an ordinary Approve button is a convenience, not a barrier.
- **Without the owner.** [Assistive apps can control other apps](https://developer.apple.com/documentation/applicationservices/axuielement_h) [with the person's permission](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac). [Apple forum replies](https://developer.apple.com/forums/tags/accessibility) say this doesn't work in the sandbox, which rules out the Mac App Store.

## Windows

- **Declarations.** [App Actions](https://learn.microsoft.com/en-us/windows/ai/app-actions/) use JSON definitions, typed entities and package identity, [targeting build 26100+](https://learn.microsoft.com/en-us/windows/ai/app-actions/actions-get-started). They are meant for atomic actions useful outside the app. [MCP on Windows, its registry and agent connectors](https://learn.microsoft.com/en-us/windows/ai/mcp/overview) are prerelease and need [build 26220.7262+](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-windows-identity). The [agent workspace setting](https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features) is off by default. [UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32) is the accessibility layer.
- **Define once.** Medium. `[WindowsAction]` attributes [generate the action JSON](https://learn.microsoft.com/en-us/windows/ai/app-actions/actions-get-started), and the MCP side is a [separate manifest that must match runtime responses](https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/agent-ready-lob-apps). Availability therefore has to be enforced at call time. Inference: a source generator could emit both files plus a WinUI command.
- **Agent access.** Hosts [list servers with `odr.exe` and connect over stdio](https://learn.microsoft.com/en-us/windows/ai/mcp/quickstart-mcp-host), and hosts will need package identity at stable release. [Registration doesn't connect every agent product](https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/agent-ready-lob-apps). Registered servers run [contained, in a separate session and account](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-containment), without access to the user's apps and windows. Running in the user session needs an unpackaged server plus a "reduce protections" setting. Inference: a host launching a plain server directly skips the registry and its containment.
- **Drafts.** Microsoft documents GAHI's pattern: [`create_expense_draft`, then `submit_for_approval(draft_id)`](https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/agent-ready-lob-apps), with the app opening the draft. It leans on a service-side store. Inference: a third party's [topmost window](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles) over an app only paints.
- **Approval.** The [guidance](https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/govern-agent-actions) binds approval to the record, values, draft version, approver and expiry, and says not to accept an agent-supplied `confirmed` parameter. Its four risk tiers resemble undo cost but are "not a Windows or MCP enforcement feature". OS tools are [`UserConsentVerifier`](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier) and [`KeyCredential.RequestSignAsync`](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.keycredential.requestsignasync).
- **Without the owner.** [Medium-level assistive apps can drive other apps but not elevated UI](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview), and consent dialogs run higher to stop simulated input. Inference: a normal agent can press Approve in a normal app.

## Linux

- **Declarations.** I found no official GNOME, KDE or freedesktop agent API, only community projects such as [kwin-mcp](https://discuss.kde.org/t/kwin-mcp-mcp-server-for-gui-automation-using-kwins-eis-interface-and-virtual-sessions/44678). What exists: [GApplication actions exported on the session bus](https://docs.gtk.org/gio/class.Application.html), [`.desktop` actions](http://specifications.freedesktop.org/desktop-entry/latest/extra-actions.html) for launching, and [AT-SPI's Action interface](https://docs.gtk.org/atspi2/iface.Action.html), [GTK's Linux default as of May 2025](https://blogs.gnome.org/gtk/2025/05/12/an-accessibility-update/). The [Newton replacement](https://blogs.gnome.org/a11y/author/mattcampbell/) wasn't upstream at last report.
- **Define once.** Medium. A GTK widget [binds to an action by name](https://docs.gtk.org/gtk4/iface.Actionable.html), and that action is on the bus, so one definition gives button and remote call. Inference: descriptions, schemas and undo cost must come from the kit.
- **Agent access.** Inference: an unsandboxed same-user process can call the bus, and a small MCP stdio process can bridge it easily. [Flatpak filters the session bus by default](https://docs.flatpak.org/en/latest/sandbox-permissions.html).
- **Drafts.** In the app only. [Layer-shell overlays work on KWin and Sway but not Mutter](https://wayland.app/protocols/wlr-layer-shell-unstable-v1), so third-party overlays aren't portable.
- **Approval.** [Polkit](https://www.freedesktop.org/software/polkit/docs/latest/polkit.8.html) serves privileged programs. Inference: it's a poor fit for approvals inside one user's app. Use a fingerprint or hardware key where present, or a sandboxed agent.
- **Without the owner.** GNOME's older wiki says the AT-SPI bus has [no access control and clients can see each other](https://wiki.gnome.org/Projects/GTK/Accessibility). The [RemoteDesktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html) injects input after a consent dialog but doesn't read UI structure.

## Cross-platform frameworks

Inference: one kit can share the core (objects, drafts, outbox, limits, agent view, MCP), but not the system declarations, which need generated native code per platform.

- **React Native.** Expo's alpha [`expo-app-intents`](https://docs.expo.dev/versions/latest/sdk/app-intents/) proves the pattern: Swift declares, JavaScript handles. I found no AppFunctions equivalent.
- **Flutter.** [Semantics builds an accessibility tree](https://docs.flutter.dev/ui/accessibility/assistive-technologies), with [desktop role gaps](https://github.com/flutter/flutter/issues/195739). I found no official App Intents or AppFunctions support.
- **Electron and Tauri.** Inference: the fastest route, because the web kit can run nearly unchanged, though without system declarations. Electron's [Mac App Store build warns that some accessibility features may not work](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide). Tauri can ship an MCP server as a [sidecar](https://v2.tauri.app/develop/sidecar/).
- **.NET MAUI.** Its [`AppActions`](https://learn.microsoft.com/en-us/dotnet/maui/platform-integration/appmodel/app-actions) are home-screen shortcuts, not agent actions. The [C# MCP SDK](https://github.com/modelcontextprotocol/csharp-sdk) suits Windows, and [.NET binds AppFunctions](https://learn.microsoft.com/en-us/dotnet/api/android.app.appfunctions.appfunctionmanager?view=net-android-36.0).

## Store rules

- **Apple.** [5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/) requires disclosure and explicit permission before sharing personal data with third-party AI. 2.4.5(i) requires the Mac App Store sandbox. I found no rule specific to agents or local MCP servers.
- **Google Play.** The accessibility ban above, plus a [rule effective 14 April 2027](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en) that AppFunctions must not deceive or manipulate agents.
- **Microsoft Store.** [Policy 11.16](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) requires disclosing live generative AI; I found no agent rule. Production MCP registration needs a [certificate in the Microsoft Trusted Root Program](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-windows-identity).
- **Flathub.** [Static permissions must be minimal, and an available portal is mandatory](https://docs.flathub.org/docs/for-app-authors/requirements).

## Same and different

**Same (inference):** the pure change function, draft and outbox logic; no approve tool; approval bound to a draft hash; preview drawn by the app. Declared hints enforce nothing: [MCP annotations are untrusted](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and Apple says [app skills can't enforce behaviour](https://developer.apple.com/documentation/appintents/orchestrating-complex-actions-with-app-skills).

**Different:** who may call, where the server runs, whether a button can be shielded from accessibility, and how the app is distributed.

## Recommendation: macOS first

*All of this section is inference.*

macOS alone combines a close define-once path, an outside-agent route with no privileged permission, an app and server sharing one session, and a biometric sensor on many machines. The Swift work also carries to iOS. Windows is a close second, and its documentation describes GAHI best, but its system route is prerelease and contained servers can't reach the app.

**Smallest prototype:** a small native invoice app with three actions: rename (easy), delete (hard), and email a summary (held in the outbox). Build these parts:

1. A `GahiAction` protocol on top of App Intents, with undo cost, availability and a pure change function.
2. An in-process MCP server with tools for reading the agent view and creating drafts. It has no approve tool.
3. A SwiftUI view drawn from base state plus drafts, with pending badges and an approval sheet.
4. Touch ID signing of the draft hash for hard actions, checked at commit.

**Tests that decide the idea:**

- Does one definition cover the button, agent view, tool and Siri tool?
- Do people understand the preview?
- Can an agent with Accessibility permission press Approve? I expect normal actions to pass and hard actions to stop at Touch ID.
- Is a draft edited after approval rejected?

**Rough effort for one Swift engineer:** one day to test whether a kit protocol works with App Intents' build-time extraction, then a week on the app and drafts, a week on MCP and the agent view, and up to a week on approval and the attack tests. Leave out sync, a server and iOS.

## What I couldn't verify

- Whether OS biometric prompts resist synthetic input from a same-user process. No vendor doc I read says so. Physical sensors make it likely (inference).
- Whether generated or kit-wrapped types pass Apple's App Intents build-time extraction.
- Apple's position on accessibility in the sandbox. I saw the forum replies only through search results, and they aren't formal documentation.
- Whether shipping Android devices match AOSP's permission data, and whether a third-party agent can use the named-package access level on stock devices.
- How a contained Windows server should hand off to a local-only app. Microsoft says to design it explicitly but names no local mechanism. I also found no general-availability date for MCP on Windows.
- Linux gaps come from searches, not statements. The Newton status dates from 2024 and 2025, and the AT-SPI wiki page is old.
- Blogs conflict on whether iOS 27 has system-wide MCP. The Apple documents I read mention only Xcode.
