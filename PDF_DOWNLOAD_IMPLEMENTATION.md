# P&L Report PDF Download Implementation

## Overview
This document describes the implementation of the PDF download feature for P&L reports in the Yona Render Site application.

## Feature Description
The PDF download feature allows users to export generated P&L reports as PDF files. The implementation:
- Filters out reports with zero income to reduce file size
- Maintains proper formatting and styling for print
- Generates dynamic filenames based on hierarchy, entity, and date
- Uses the PDFShift API for PDF conversion

## Implementation Details

### Frontend (`pl-view.html`)

#### 1. Helper Functions

**`parseAccountingToNumber(text)`**
- Parses accounting-style numbers (e.g., "(1,234)" for negatives, "-" for zero)
- Returns numeric values for comparison

**`hasNonZeroIncome(containerEl)`**
- Checks if a report container has a non-zero "Income" row
- Used to filter out empty/zero-revenue reports before PDF generation
- Looks for the "Income" label in the first column and checks the "Actual" value (2nd column)

**`downloadPDF()`** (async)
- Main function triggered by "Download PDF" button
- Steps:
  1. Gets HTML content from `pnlContent` container
  2. Parses HTML into DOM
  3. Filters report containers to keep only those with non-zero income
  4. Builds complete printable HTML with embedded styles
  5. Calls PDFShift API to convert HTML to PDF
  6. Downloads the PDF file to user's computer

#### 2. PDF Styles
The PDF uses optimized styles for printing:
- **Container**: `.pnl-report-container` with page-break-after for multi-page reports
- **Header**: `.pnl-report-header` with title, subtitle, and metadata
- **Table**: `.pnl-report-table` with compact 7.5px font size
- **Layout**: Proper margins (10px all sides) and portrait orientation
- **Empty cells**: Centered dashes for visual consistency

#### 3. Dynamic Filename
Format: `PNL_{Hierarchy}_{EntityName}_{Date}.pdf`
- Example: `PNL_District_West_Region_District_2024-12-01.pdf`
- Sanitizes entity names by replacing special characters with underscores

### API Integration

#### PDFShift API
- **Endpoint**: `https://api.pdfshift.io/v3/convert/pdf`
- **API Key**: `sk_3df748acf1ce265988e07e04544b6452ece1b20e` (configured in code)
- **Parameters**:
  - `source`: Complete HTML string with embedded CSS
  - `landscape`: false (portrait mode)
  - `use_print`: true (uses print-specific CSS rules)
  - `margin`: 10px on all sides

## User Flow

1. User selects hierarchy level (District, Region, or Subsidiary)
2. User selects specific entity from dropdown
3. User selects date
4. User clicks "Refresh Data" to generate report
5. User clicks "Download PDF" button
6. System:
   - Validates report data exists
   - Filters out zero-income reports
   - Shows "Generating PDF..." status
   - Calls PDFShift API
   - Downloads PDF file
   - Restores button to normal state

## Error Handling

- **No Report Data**: Alert if user tries to download before generating a report
- **API Errors**: Catches and displays PDFShift API errors with details
- **Empty Results**: Falls back to first report container if all reports filtered out
- **Loading State**: Disables button during PDF generation to prevent duplicate requests

## Testing

To test the PDF download feature:

1. Start the development server:
   ```bash
   cd yona_render_site
   npm start
   ```

2. Navigate to: `http://localhost:3000/pl-view`

3. Select a hierarchy level, entity, and date

4. Click "Refresh Data" to generate a report

5. Click "Download PDF" to download the report

6. Verify:
   - PDF downloads successfully
   - Filename is descriptive and accurate
   - All reports with non-zero income are included
   - Formatting matches the original HTML report
   - Page breaks are properly applied

## Code References

- **Main Implementation**: `yona_render_site/public/pl-view.html` (lines ~1407-1650)
- **Download Button**: Line 778
- **Helper Functions**: Lines 1407-1442
- **PDF Generation**: Lines 1443-1650

## Dependencies

- **PDFShift**: External API for HTML to PDF conversion (requires API key)
- **Browser APIs**: 
  - `DOMParser` for HTML parsing
  - `Blob` and `URL.createObjectURL` for file download
  - `fetch` for API calls

## Future Enhancements

Potential improvements for the future:
- Add option to include/exclude zero-income reports
- Allow users to select landscape vs portrait orientation
- Customize PDF margins
- Add company logo/branding to PDF header
- Batch download multiple periods
- Email PDF directly from the application
- Cache generated PDFs for faster repeated downloads

## Notes

- The implementation follows the pattern established in the Retool codebase
- Uses accounting-style number formatting (parentheses for negatives)
- Properly handles page breaks to avoid orphaned content
- Filters intelligently to reduce PDF size without losing data
- Loading states provide clear feedback during generation process

