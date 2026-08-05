import "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue,
  > {
    /** Additional className applied to the <th> header cell */
    headerClassName?: string;
    /** Additional className applied to each <td> body cell */
    cellClassName?: string;
  }
}
