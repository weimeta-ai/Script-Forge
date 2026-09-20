import * as XLSX from 'xlsx'

const downloadFileToExcel = (dataList, name, options = {}) => {
	const workbook = XLSX.utils.book_new()

	// 处理多工作表情况
	if (options.multiSheet && Array.isArray(dataList)) {
		// 多工作表模式：dataList 是工作表对象数组
		dataList.forEach((sheet) => {
			if (!sheet.sheetName || !sheet.data || !Array.isArray(sheet.data)) {
				console.error('Invalid sheet format for multiSheet export')
				return
			}

			const worksheet = createWorksheet(sheet.data)
			XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName)
		})
	} else {
		// 单工作表模式：dataList 是二维数组
		const worksheet = createWorksheet(dataList)
		const sheetName = options.sheetName || 'Sheet1'
		XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
	}

	// 生成文件名（如果传入了带时间戳的名称，不再添加额外时间戳）

	XLSX.writeFile(workbook, name)
}

// 创建并设置工作表样式
const createWorksheet = (data) => {
	const worksheet = XLSX.utils.aoa_to_sheet(data)

	// 设置最大宽度（字符数）
	const MAX_COL_WIDTH = 40
	const cols = []

	if (data.length > 0) {
		for (let colIndex = 0; colIndex < data[0].length; colIndex++) {
			let maxColWidth = 10 // 默认宽度

			for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
				const cellValue = data[rowIndex][colIndex]
				if (cellValue != null) {
					const cellStr = String(cellValue)
					const width = cellStr.replace(/[^\x00-\xff]/g, '00').length
					if (width > maxColWidth) {
						maxColWidth = width
					}
				}
			}
			cols.push({ wch: Math.min(maxColWidth + 2, MAX_COL_WIDTH) }) // 限制最大宽度
		}
		worksheet['!cols'] = cols
	}

	// 样式设置
	Object.keys(worksheet).forEach((key) => {
		if (!key.startsWith('!')) {
			worksheet[key].s = {
				font: {
					sz: 12
				},
				alignment: {
					horizontal: 'left',
					vertical: 'center',
					wrapText: true
				},
				border: {
					top: { style: 'thin' },
					right: { style: 'thin' },
					bottom: { style: 'thin' },
					left: { style: 'thin' }
				}
			}
		}
	})

	return worksheet
}

export default downloadFileToExcel
