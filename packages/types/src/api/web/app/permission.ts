import { PermissionLevel } from "../../../sdk"

export interface FetchResourcePermissionInfoResponse {
  [key: string]: Record<string, string>
}

export interface ResourcePermissionInfo {
  role: string
  permissionType: string
  inheritablePermission?: string
}

export interface GetResourcePermsResponse {
  permissions: Record<string, ResourcePermissionInfo>
}

export interface GetDependantResourcesResponse {
  resourceByType?: Record<string, number>
}

export interface AddedPermission {
  _id?: string
  rev?: string
  error?: string
  reason?: string
}

export interface AddPermissionResponse {}

export interface AddPermissionRequest {
  roleId: string
  resourceId: string
  level: PermissionLevel
}

export interface RemovePermissionRequest extends AddPermissionRequest {}
export interface RemovePermissionResponse {}
