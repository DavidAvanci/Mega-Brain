/** A Codex home owns its sessions and authentication; credentials never cross this contract. */
export type CodexProfile = {
  id: string
  name: string
  home: string
  color: string
}

export type CodexProfiles = {
  profiles: CodexProfile[]
  activeId: string
}

export type CodexProfilesResponse = CodexProfiles & {
  discovered: { name: string; home: string }[]
}
