import {
  EmptyFilterOption,
  FieldType,
  Row,
  RowSearchParams,
  SearchResponse,
  SortOrder,
  Table,
} from "@budibase/types"
import { isExternalTableID } from "../../../integrations/utils"
import * as internal from "./search/internal"
import * as external from "./search/external"
import { ExportRowsParams, ExportRowsResult } from "./search/types"
import { dataFilters } from "@budibase/shared-core"
import sdk from "../../index"
import { searchInputMapping } from "./search/utils"
import { db as dbCore } from "@budibase/backend-core"
import tracer from "dd-trace"
import { removeInvalidFilters } from "./queryUtils"

export { isValidFilter } from "../../../integrations/utils"

export interface ViewParams {
  calculation: string
  group: string
  field: string
}

function pickApi(tableId: any) {
  if (isExternalTableID(tableId)) {
    return external
  }
  return internal
}

export async function search(
  options: RowSearchParams
): Promise<SearchResponse<Row>> {
  return await tracer.trace("search", async span => {
    span?.addTags({
      tableId: options.tableId,
      query: options.query,
      sort: options.sort,
      sortOrder: options.sortOrder,
      sortType: options.sortType,
      limit: options.limit,
      bookmark: options.bookmark,
      paginate: options.paginate,
      fields: options.fields,
      countRows: options.countRows,
    })

    const isExternalTable = isExternalTableID(options.tableId)
    options.query = dataFilters.cleanupQuery(options.query || {})
    options.query = dataFilters.fixupFilterArrays(options.query)

    span?.addTags({
      cleanedQuery: options.query,
      isExternalTable,
    })

    if (
      !dataFilters.hasFilters(options.query) &&
      options.query.onEmptyFilter === EmptyFilterOption.RETURN_NONE
    ) {
      span?.addTags({ emptyQuery: true })
      return {
        rows: [],
      }
    }

    if (options.sortOrder) {
      options.sortOrder = options.sortOrder.toLowerCase() as SortOrder
    }

    const table = await sdk.tables.getTable(options.tableId)
    options = searchInputMapping(table, options)

    const visibleTableFields = Object.keys(table.schema).filter(
      f => table.schema[f].visible !== false
    )

    if (options.fields) {
      const tableFields = visibleTableFields.map(f => f.toLowerCase())
      options.fields = options.fields.filter(f =>
        tableFields.includes(f.toLowerCase())
      )
    } else {
      options.fields = visibleTableFields
    }

    options.query = removeInvalidFilters(
      options.query,
      await getQueriableFields(options.fields, table)
    )

    let result: SearchResponse<Row>
    if (isExternalTable) {
      span?.addTags({ searchType: "external" })
      result = await external.search(options, table)
    } else if (dbCore.isSqsEnabledForTenant()) {
      span?.addTags({ searchType: "sqs" })
      result = await internal.sqs.search(options, table)
    } else {
      span?.addTags({ searchType: "lucene" })
      result = await internal.lucene.search(options, table)
    }

    span?.addTags({
      foundRows: result.rows.length,
      totalRows: result.totalRows,
    })

    return result
  })
}

export async function exportRows(
  options: ExportRowsParams
): Promise<ExportRowsResult> {
  return pickApi(options.tableId).exportRows(options)
}

export async function fetch(tableId: string): Promise<Row[]> {
  return pickApi(tableId).fetch(tableId)
}

export async function fetchRaw(tableId: string): Promise<Row[]> {
  return pickApi(tableId).fetchRaw(tableId)
}

export async function fetchView(
  tableId: string,
  viewName: string,
  params: ViewParams
): Promise<Row[]> {
  return pickApi(tableId).fetchView(viewName, params)
}

async function getQueriableFields(
  fields: string[],
  table: Table
): Promise<string[]> {
  const handledTables = new Set<string>([table._id!])
  const extractTableFields = async (
    table: Table,
    allowedFields: string[]
  ): Promise<string[]> => {
    const result = []
    for (const field of Object.keys(table.schema).filter(f =>
      allowedFields.includes(f)
    )) {
      const subSchema = table.schema[field]
      if (subSchema.type === FieldType.LINK) {
        if (handledTables.has(`${table._id}_${subSchema.tableId}`)) {
          // avoid circular loops
          continue
        }
        handledTables.add(`${subSchema.tableId}_${table._id}`)
        const relatedTable = await sdk.tables.getTable(subSchema.tableId)
        const relatedFields = await extractTableFields(
          relatedTable,
          Object.keys(relatedTable.schema)
        )

        result.push(...relatedFields.map(f => `${subSchema.name}.${f}`))
        // should be able to filter by relationship using table name
        result.push(...relatedFields.map(f => `${relatedTable.name}.${f}`))
      } else {
        result.push(field)
      }
    }
    return result
  }

  const result = [
    "_id", // Querying by _id is always allowed, even if it's never part of the schema
  ]

  result.push(...(await extractTableFields(table, fields)))

  return result
}
