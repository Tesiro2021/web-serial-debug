;(function () {
	if (!('serial' in navigator)) {
		alert('当前浏览器不支持串口操作,请更换Edge或Chrome浏览器')
	}
	let serialPort = null
	navigator.serial.getPorts().then((ports) => {
		if (ports.length > 0) {
			serialPort = ports[0]
			serialStatuChange(true)
			setSerialState(SERIAL_STATES.CLOSED)
		}
	})
	let reader
	const SERIAL_STATES = {
		NO_PORT: 'no_port',
		CLOSED: 'closed',
		OPENING: 'opening',
		OPEN: 'open',
		CLOSING: 'closing',
	}
	let serialState = SERIAL_STATES.NO_PORT
	let serialDesiredOpen = false
	//串口分包合并时钟
	let serialTimer = null
	//串口循环发送时钟
	let serialloopSendTimer = null
	//串口缓存数据
	let serialData = []
	//文本解码
	let textdecoder = new TextDecoder()
	const MAX_LOG_ENTRIES = 0
	const MAX_QUICK_GROUPS = 50
	const MAX_QUICK_ITEMS_PER_GROUP = 500
	const MAX_QUICK_CONTENT_LENGTH = 4096
	let currQuickSend = []
	//快捷发送列表
	let quickSendList = [
		{
			name: 'ESP32 AT指令',
			list: [
				{
					name: '测试 AT 启动',
					content: 'AT',
					hex: false,
				},
				{
					name: '重启模块',
					content: 'AT+RST',
					hex: false,
				},
				{
					name: '查看版本信息',
					content: 'AT+GMR',
					hex: false,
				},
				{
					name: '查询当前固件支持的所有命令及命令类型',
					content: 'AT+CMD?',
					hex: false,
				},
				{
					name: '进⼊ Deep-sleep 模式 1分钟',
					content: 'AT+GSLP=60000',
					hex: false,
				},
				{
					name: '开启AT回显功能',
					content: 'ATE1',
					hex: false,
				},
				{
					name: '关闭AT回显功能',
					content: 'ATE0',
					hex: false,
				},
				{
					name: '恢复出厂设置',
					content: 'AT+RESTORE',
					hex: false,
				},
				{
					name: '查询 UART 当前临时配置',
					content: 'AT+UART_CUR?',
					hex: false,
				},
				{
					name: '设置 UART 115200 保存flash',
					content: 'AT+UART_DEF=115200,8,1,0,3',
					hex: false,
				},
				{
					name: '查询 sleep 模式',
					content: 'AT+SLEEP?',
					hex: false,
				},
				{
					name: '查询当前剩余堆空间和最小堆空间',
					content: 'AT+SYSRAM?',
					hex: false,
				},
				{
					name: '查询系统提示信息',
					content: 'AT+SYSMSG?',
					hex: false,
				},
				{
					name: '查询 flash 用户分区',
					content: 'AT+SYSFLASH?',
					hex: false,
				},
				{
					name: '查询本地时间戳',
					content: 'AT+SYSTIMESTAMP?',
					hex: false,
				},
				{
					name: '查询 AT 错误代码提示',
					content: 'AT+SYSLOG?',
					hex: false,
				},
				{
					name: '设置/查询系统参数存储模式',
					content: 'AT+SYSPARA?',
					hex: false,
				},
			],
		},
	]
	let worker = null
	let workerObjectUrl = null
	//工具配置
	const DEFAULT_TOOL_OPTIONS = {
		//自动滚动
		autoScroll: true,
		//显示时间 界面未开放
		showTime: true,
		showSendPanel: true,
		showDirection: true,
		showLeftSidebar: true,
		showRightSidebar: true,
		//日志类型
		logType: 'hex&text',
		//分包合并时间
		timeOut: 50,
		//末尾加回车换行
		addCRLF: false,
		//HEX发送
		hexSend: false,
		//循环发送
		loopSend: false,
		//循环发送时间
		loopSendTime: 1000,
		//输入的发送内容
		sendContent: '',
		//快捷发送选中索引
		quickSendIndex: 0,
	}
	let toolOptions = { ...DEFAULT_TOOL_OPTIONS }

	let serialOp = Promise.resolve()
	function runSerialOp(op) {
		serialOp = serialOp.then(op, op)
		return serialOp
	}

	function safeJsonParse(text) {
		if (typeof text !== 'string' || !text) {
			return null
		}
		try {
			return JSON.parse(text)
		} catch {
			return null
		}
	}
	function clampInt(value, min, max, fallback) {
		const n = Number.parseInt(value, 10)
		if (!Number.isFinite(n)) {
			return fallback
		}
		return Math.min(max, Math.max(min, n))
	}
	function normalizeToolOptions(obj) {
		const source = obj && typeof obj === 'object' ? obj : {}
		const logType = ['hex&text', 'hex', 'text', 'ansi'].includes(source.logType) ? source.logType : DEFAULT_TOOL_OPTIONS.logType
		return {
			autoScroll: typeof source.autoScroll === 'boolean' ? source.autoScroll : DEFAULT_TOOL_OPTIONS.autoScroll,
			showTime: typeof source.showTime === 'boolean' ? source.showTime : DEFAULT_TOOL_OPTIONS.showTime,
			showSendPanel: typeof source.showSendPanel === 'boolean' ? source.showSendPanel : DEFAULT_TOOL_OPTIONS.showSendPanel,
			showDirection: typeof source.showDirection === 'boolean' ? source.showDirection : DEFAULT_TOOL_OPTIONS.showDirection,
			showLeftSidebar: typeof source.showLeftSidebar === 'boolean' ? source.showLeftSidebar : DEFAULT_TOOL_OPTIONS.showLeftSidebar,
			showRightSidebar: typeof source.showRightSidebar === 'boolean' ? source.showRightSidebar : DEFAULT_TOOL_OPTIONS.showRightSidebar,
			logType,
			timeOut: clampInt(source.timeOut, 0, 60000, DEFAULT_TOOL_OPTIONS.timeOut),
			addCRLF: typeof source.addCRLF === 'boolean' ? source.addCRLF : DEFAULT_TOOL_OPTIONS.addCRLF,
			hexSend: typeof source.hexSend === 'boolean' ? source.hexSend : DEFAULT_TOOL_OPTIONS.hexSend,
			loopSend: typeof source.loopSend === 'boolean' ? source.loopSend : DEFAULT_TOOL_OPTIONS.loopSend,
			loopSendTime: clampInt(source.loopSendTime, 1, 3600000, DEFAULT_TOOL_OPTIONS.loopSendTime),
			sendContent: typeof source.sendContent === 'string' ? source.sendContent.slice(0, MAX_QUICK_CONTENT_LENGTH) : DEFAULT_TOOL_OPTIONS.sendContent,
			quickSendIndex: clampInt(source.quickSendIndex, 0, 1_000_000, DEFAULT_TOOL_OPTIONS.quickSendIndex),
		}
	}
	function normalizeSerialOptions(obj) {
		const source = obj && typeof obj === 'object' ? obj : {}
		const parity = ['none', 'even', 'odd'].includes(source.parity) ? source.parity : 'none'
		const flowControl = ['none', 'hardware'].includes(source.flowControl) ? source.flowControl : 'none'
		const dataBits = [7, 8].includes(Number(source.dataBits)) ? Number(source.dataBits) : 8
		const stopBits = [1, 2].includes(Number(source.stopBits)) ? Number(source.stopBits) : 1
		return {
			baudRate: clampInt(source.baudRate, 1, 10_000_000, 115200),
			dataBits,
			stopBits,
			parity,
			bufferSize: clampInt(source.bufferSize, 255, 16_777_216, 1024),
			flowControl,
		}
	}
	function normalizeQuickItem(obj) {
		const source = obj && typeof obj === 'object' ? obj : {}
		const name = typeof source.name === 'string' ? source.name.slice(0, 64) : '发送'
		const content = typeof source.content === 'string' ? source.content.slice(0, MAX_QUICK_CONTENT_LENGTH) : ''
		const hex = typeof source.hex === 'boolean' ? source.hex : false
		return { name, content, hex }
	}
	function normalizeQuickSendList(list) {
		if (!Array.isArray(list)) {
			return null
		}
		const groups = []
		for (const g of list.slice(0, MAX_QUICK_GROUPS)) {
			const groupObj = g && typeof g === 'object' ? g : {}
			const groupName = typeof groupObj.name === 'string' ? groupObj.name.slice(0, 64) : '分组'
			const itemsRaw = Array.isArray(groupObj.list) ? groupObj.list : []
			const items = itemsRaw.slice(0, MAX_QUICK_ITEMS_PER_GROUP).map(normalizeQuickItem)
			groups.push({ name: groupName, list: items })
		}
		return groups.length > 0 ? groups : null
	}
	function normalizeImportedQuickItems(list) {
		if (!Array.isArray(list)) {
			return []
		}
		return list.slice(0, MAX_QUICK_ITEMS_PER_GROUP).map(normalizeQuickItem)
	}

	const logQueue = []
	let logFlushScheduled = false
	let logGeneration = 0
	let deviceTimeDayOffsetMs = 0
	let deviceTimeMaxKey = -Infinity
	function resetDeviceTimeSortState() {
		deviceTimeDayOffsetMs = 0
		deviceTimeMaxKey = -Infinity
	}
	function getDeviceSortKeyFromLine(line) {
		const m = String(line).match(/^\s*(?:[IW]\s+)?\((\d{2}):(\d{2}):(\d{2})\.(\d{3})\)/)
		if (!m) {
			return null
		}
		const hour = Number(m[1])
		const minute = Number(m[2])
		const second = Number(m[3])
		const ms = Number(m[4])
		if (![hour, minute, second, ms].every(Number.isFinite)) {
			return null
		}
		const msOfDay = ((hour * 60 + minute) * 60 + second) * 1000 + ms
		let key = msOfDay + deviceTimeDayOffsetMs
		if (key + 12 * 60 * 60 * 1000 < deviceTimeMaxKey) {
			deviceTimeDayOffsetMs += 24 * 60 * 60 * 1000
			key = msOfDay + deviceTimeDayOffsetMs
		}
		deviceTimeMaxKey = Math.max(deviceTimeMaxKey, key)
		return key
	}
	function insertLogNodeSorted(node) {
		const keyRaw = node?.dataset?.sortKey
		const key = keyRaw != null ? Number(keyRaw) : Number.NaN
		if (!Number.isFinite(key)) {
			serialLogs.appendChild(node)
			return
		}
		const last = serialLogs.lastElementChild
		const lastKeyRaw = last?.dataset?.sortKey
		const lastKey = lastKeyRaw != null ? Number(lastKeyRaw) : Number.NaN
		if (!last || !Number.isFinite(lastKey) || lastKey <= key) {
			serialLogs.appendChild(node)
			return
		}
		let cursor = last
		let steps = 0
		while (cursor && steps < 500) {
			const cursorKeyRaw = cursor?.dataset?.sortKey
			const cursorKey = cursorKeyRaw != null ? Number(cursorKeyRaw) : Number.NaN
			if (!Number.isFinite(cursorKey) || cursorKey <= key) {
				cursor.after(node)
				return
			}
			cursor = cursor.previousElementSibling
			steps++
		}
		serialLogs.prepend(node)
	}
	function enqueueLogNode(node) {
		logQueue.push(node)
		if (logFlushScheduled) {
			return
		}
		logFlushScheduled = true
		const generationAtSchedule = logGeneration
		requestAnimationFrame(() => {
			if (generationAtSchedule !== logGeneration) {
				logFlushScheduled = false
				return
			}
			logFlushScheduled = false
			if (logQueue.length === 0) {
				return
			}
			const fragment = document.createDocumentFragment()
			for (const n of logQueue.splice(0, logQueue.length)) {
				if (n?.dataset?.sortKey != null) {
					insertLogNodeSorted(n)
				} else {
					fragment.appendChild(n)
				}
			}
			if (fragment.childNodes.length > 0) {
				serialLogs.append(fragment)
			}
			if (MAX_LOG_ENTRIES > 0) {
				while (serialLogs.childElementCount > MAX_LOG_ENTRIES) {
					serialLogs.firstElementChild?.remove()
				}
			}
			if (toolOptions.autoScroll) {
				serialLogs.scrollTop = serialLogs.scrollHeight - serialLogs.clientHeight
			}
		})
	}

	function setSerialState(next) {
		serialState = next
		if (serialState === SERIAL_STATES.OPEN) {
			serialToggle.innerHTML = '关闭串口'
		} else {
			serialToggle.innerHTML = '打开串口'
		}
		serialToggle.disabled = serialState === SERIAL_STATES.OPENING || serialState === SERIAL_STATES.CLOSING
	}

	//生成快捷发送列表
	let quickSend = document.getElementById('serial-quick-send')
	let sendList = localStorage.getItem('quickSendList')
	if (sendList) {
		const parsed = safeJsonParse(sendList)
		const normalized = normalizeQuickSendList(parsed)
		if (normalized) {
			quickSendList = normalized
		}
	}
	quickSendList.forEach((item, index) => {
		let option = document.createElement('option')
		option.innerText = item.name
		option.value = index
		quickSend.appendChild(option)
	})

	function createQuickItemElement(item) {
		const wrapper = document.createElement('div')
		wrapper.className = 'd-flex p-1 border-bottom quick-item'

		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.title = '移除该项'
		removeBtn.className = 'btn btn-sm btn-outline-secondary me-1 quick-remove'
		removeBtn.innerHTML = '<i class="bi bi-x"></i>'

		const input = document.createElement('input')
		input.className = 'form-control form-control-sm me-1'
		input.placeholder = '要发送的内容,双击改名'
		input.value = item?.content ?? ''

		const sendBtn = document.createElement('button')
		sendBtn.className = 'flex-shrink-0 me-1 align-self-center btn btn-secondary btn-sm quick-send'
		sendBtn.title = item?.name ?? ''
		sendBtn.textContent = item?.name ?? ''

		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.className = 'form-check-input flex-shrink-0 align-self-center'
		checkbox.checked = !!item?.hex

		wrapper.append(removeBtn, input, sendBtn, checkbox)
		return wrapper
	}

	//快捷发送列表被单击
	document.getElementById('serial-quick-send-content').addEventListener('click', (e) => {
		let curr = e.target
		if (curr.tagName != 'BUTTON') {
			curr = curr.parentNode
		}
		if (curr.tagName != 'BUTTON') {
			return
		}
		const index = Array.from(curr.parentNode.parentNode.children).indexOf(curr.parentNode)
		if (curr.classList.contains('quick-remove')) {
			currQuickSend.list.splice(index, 1)
			curr.parentNode.remove()
			saveQuickList()
			return
		}
		if (curr.classList.contains('quick-send')) {
			let item = currQuickSend.list[index]
			if (item.hex) {
				sendHex(item.content)
				return
			}
			sendText(item.content)
		}
	})
	//快捷列表双击改名
	document.getElementById('serial-quick-send-content').addEventListener('dblclick', (e) => {
		let curr = e.target
		if (curr.tagName != 'INPUT' || curr.type != 'text') {
			return
		}
		const index = Array.from(curr.parentNode.parentNode.children).indexOf(curr.parentNode)
		changeName((name) => {
			currQuickSend.list[index].name = name
			const sendBtn = curr.parentNode.querySelector('.quick-send')
			if (sendBtn) {
				sendBtn.textContent = name
				sendBtn.title = name
			}
			saveQuickList()
		}, currQuickSend.list[index].name)
	})
	//快捷发送列表被改变
	document.getElementById('serial-quick-send-content').addEventListener('change', (e) => {
		let curr = e.target
		if (curr.tagName != 'INPUT') {
			return
		}
		const index = Array.from(curr.parentNode.parentNode.children).indexOf(curr.parentNode)
		if (curr.type == 'text') {
			currQuickSend.list[index].content = curr.value
		}
		if (curr.type == 'checkbox') {
			currQuickSend.list[index].hex = curr.checked
		}
		saveQuickList()
	})
	function saveQuickList() {
		localStorage.setItem('quickSendList', JSON.stringify(quickSendList))
	}

	const quickSendContent = document.getElementById('serial-quick-send-content')
	//快捷发送列表更换选项
	quickSend.addEventListener('change', (e) => {
		let index = parseInt(e.target.value, 10)
		if (index != -1) {
			changeOption('quickSendIndex', index)
			currQuickSend = quickSendList[index]
			//
			quickSendContent.replaceChildren()
			currQuickSend.list.forEach((item) => {
				quickSendContent.appendChild(createQuickItemElement(item))
			})
		}
	})
	//添加快捷发送
	document.getElementById('serial-quick-send-add').addEventListener('click', (e) => {
		const item = {
			name: '发送',
			content: '',
			hex: false,
		}
		currQuickSend.list.push(item)
		quickSendContent.appendChild(createQuickItemElement(item))
		saveQuickList()
	})

	//快捷发送分组新增
	document.getElementById('serial-quick-send-add-group').addEventListener('click', (e) => {
		changeName((name) => {
			quickSendList.push({
				name: name,
				list: [],
			})
			const option = document.createElement('option')
			option.value = String(quickSendList.length - 1)
			option.textContent = name
			quickSend.appendChild(option)
			quickSend.value = quickSendList.length - 1
			quickSend.dispatchEvent(new Event('change'))
			saveQuickList()
		})
	})
	//快捷发送分组重命名
	document.getElementById('serial-quick-send-rename-group').addEventListener('click', (e) => {
		changeName((name) => {
			currQuickSend.name = name
			quickSend.options[quickSend.value].innerText = name
			saveQuickList()
		}, currQuickSend.name)
	})
	//快捷发送分组删除
	document.getElementById('serial-quick-send-remove-group').addEventListener('click', (e) => {
		if (quickSendList.length == 1) {
			return
		}
		//弹窗询问是否删除
		if (!confirm('是否删除该分组?')) {
			return
		}
		quickSendList.splice(quickSend.value, 1)
		quickSend.options[quickSend.value].remove()
		quickSend.value = 0
		quickSend.dispatchEvent(new Event('change'))
		saveQuickList()
	})

	//导出
	document.getElementById('serial-quick-send-export').addEventListener('click', (e) => {
		let data = JSON.stringify(currQuickSend.list)
		let blob = new Blob([data], { type: 'text/plain' })
		const filename = String(currQuickSend?.name ?? 'quick-send').replace(/[\\/:*?"<>|]+/g, '_') + '.json'
		saveAs(blob, filename)
	})
	//导入
	document.getElementById('serial-quick-send-import-btn').addEventListener('click', (e) => {
		document.getElementById('serial-quick-send-import').click()
	})
	document.getElementById('serial-quick-send-import').addEventListener('change', (e) => {
		let file = e.target.files[0]
		e.target.value = ''
		let reader = new FileReader()
		reader.onload = function (e) {
			let data = e.target.result
			try {
				const parsed = JSON.parse(data)
				const list = normalizeImportedQuickItems(parsed)
				currQuickSend.list.push(...list)
				for (const item of list) {
					quickSendContent.appendChild(createQuickItemElement(item))
				}
				saveQuickList()
			} catch (e) {
				showMsg('导入失败:' + e.message)
			}
		}
		reader.readAsText(file)
	})
	//重置参数
	document.getElementById('serial-reset').addEventListener('click', (e) => {
		if (!confirm('是否重置参数?')) {
			return
		}
		localStorage.removeItem('serialOptions')
		localStorage.removeItem('toolOptions')
		localStorage.removeItem('quickSendList')
		localStorage.removeItem('code')
		location.reload()
	})
	//导出参数
	document.getElementById('serial-export').addEventListener('click', (e) => {
		let data = {
			serialOptions: localStorage.getItem('serialOptions'),
			toolOptions: localStorage.getItem('toolOptions'),
			quickSendList: localStorage.getItem('quickSendList'),
			code: localStorage.getItem('code'),
		}
		let blob = new Blob([JSON.stringify(data)], { type: 'text/plain' })
		saveAs(blob, 'web-serial-debug.json')
	})
	//导入参数
	document.getElementById('serial-import').addEventListener('click', (e) => {
		document.getElementById('serial-import-file').click()
	})
	function setParam(key, value) {
		if (value == null) {
			localStorage.removeItem(key)
		} else {
			localStorage.setItem(key, value)
		}
	}
	document.getElementById('serial-import-file').addEventListener('change', (e) => {
		let file = e.target.files[0]
		e.target.value = ''
		let reader = new FileReader()
		reader.onload = function (e) {
			let data = e.target.result
			try {
				let obj = JSON.parse(data)

				const serialOptionsRaw = typeof obj.serialOptions === 'string' ? safeJsonParse(obj.serialOptions) : obj.serialOptions
				const toolOptionsRaw = typeof obj.toolOptions === 'string' ? safeJsonParse(obj.toolOptions) : obj.toolOptions
				const quickSendListRaw = typeof obj.quickSendList === 'string' ? safeJsonParse(obj.quickSendList) : obj.quickSendList

				const serialOptionsNormalized = normalizeSerialOptions(serialOptionsRaw)
				const toolOptionsNormalized = normalizeToolOptions(toolOptionsRaw)
				const quickSendListNormalized = normalizeQuickSendList(quickSendListRaw)

				setParam('serialOptions', JSON.stringify(serialOptionsNormalized))
				setParam('toolOptions', JSON.stringify(toolOptionsNormalized))
				if (quickSendListNormalized) {
					setParam('quickSendList', JSON.stringify(quickSendListNormalized))
				} else {
					setParam('quickSendList', null)
				}
				setParam('code', typeof obj.code === 'string' ? obj.code : null)
				location.reload()
			} catch (e) {
				showMsg('导入失败:' + e.message)
			}
		}
		reader.readAsText(file)
	})
	const serialCodeContent = document.getElementById('serial-code-content')
	const serialCodeSelect = document.getElementById('serial-code-select')
	const code = localStorage.getItem('code')
	if (code) {
		serialCodeContent.value = code
	}
	//代码编辑器
	var editor = CodeMirror.fromTextArea(serialCodeContent, {
		lineNumbers: true, // 显示行数
		indentUnit: 4, // 缩进单位为4
		styleActiveLine: true, // 当前行背景高亮
		matchBrackets: true, // 括号匹配
		mode: 'javascript', // 设置编辑器语言为JavaScript
		// lineWrapping: true,    // 自动换行
		theme: 'idea', // 主题
	})
	//读取本地文件
	serialCodeSelect.onchange = function (e) {
		var fr = new FileReader()
		fr.onload = function () {
			editor.setValue(fr.result)
		}
		fr.readAsText(this.files[0])
	}
	document.getElementById('serial-code-load').onclick = function () {
		serialCodeSelect.click()
	}
	//运行或停止脚本
	const code_editor_run = document.getElementById('serial-code-run')
	function stopWorker() {
		if (!worker) {
			return
		}
		worker.terminate()
		worker = null
		if (workerObjectUrl) {
			window.URL.revokeObjectURL(workerObjectUrl)
			workerObjectUrl = null
		}
		code_editor_run.innerHTML = '<i class="bi bi-play"></i>运行'
		editor.setOption('readOnly', false)
		editor.getWrapperElement().classList.remove('CodeMirror-readonly')
	}
	code_editor_run.addEventListener('click', (e) => {
		if (worker) {
			stopWorker()
			return
		}
		editor.setOption('readOnly', 'nocursor')
		editor.getWrapperElement().classList.add('CodeMirror-readonly')
		localStorage.setItem('code', editor.getValue())
		code_editor_run.innerHTML = '<i class="bi bi-stop"></i>停止'
		var blob = new Blob([editor.getValue()], { type: 'text/javascript' })
		workerObjectUrl = window.URL.createObjectURL(blob)
		worker = new Worker(workerObjectUrl)
		worker.onmessage = function (e) {
			if (e.data.type == 'uart_send') {
				writeData(new Uint8Array(e.data.data)).catch((err) => addLogErr(err?.message ?? String(err)))
			} else if (e.data.type == 'uart_send_hex') {
				sendHex(e.data.data)
			} else if (e.data.type == 'uart_send_txt') {
				sendText(e.data.data)
			} else if (e.data.type == 'log') {
				addLogErr(e.data.data)
			}
		}
		worker.onerror = function (err) {
			addLogErr(err?.message ?? '脚本运行出错')
			stopWorker()
		}
	})
	//读取参数
	let options = localStorage.getItem('serialOptions')
	if (options) {
		const normalized = normalizeSerialOptions(safeJsonParse(options))
		set('serial-baud', normalized.baudRate)
		set('serial-data-bits', normalized.dataBits)
		set('serial-stop-bits', normalized.stopBits)
		set('serial-parity', normalized.parity)
		set('serial-buffer-size', normalized.bufferSize)
		set('serial-flow-control', normalized.flowControl)
		localStorage.setItem('serialOptions', JSON.stringify(normalized))
	}
	options = localStorage.getItem('toolOptions')
	if (options) {
		toolOptions = normalizeToolOptions(safeJsonParse(options))
		localStorage.setItem('toolOptions', JSON.stringify(toolOptions))
	}
	document.getElementById('serial-timer-out').value = toolOptions.timeOut
	document.getElementById('serial-log-type').value = toolOptions.logType
	document.getElementById('serial-auto-scroll').innerText = toolOptions.autoScroll ? '自动滚动' : '暂停滚动'
	document.getElementById('serial-add-crlf').checked = toolOptions.addCRLF
	document.getElementById('serial-hex-send').checked = toolOptions.hexSend
	document.getElementById('serial-loop-send').checked = toolOptions.loopSend
	document.getElementById('serial-loop-send-time').value = toolOptions.loopSendTime
	document.getElementById('serial-send-content').value = toolOptions.sendContent
	const toggleTimeBtn = document.getElementById('serial-toggle-time')
	if (toggleTimeBtn) {
		toggleTimeBtn.textContent = toolOptions.showTime ? '隐藏时间' : '显示时间'
		toggleTimeBtn.addEventListener('click', () => {
			const next = !toolOptions.showTime
			changeOption('showTime', next)
			toggleTimeBtn.textContent = next ? '隐藏时间' : '显示时间'
		})
	}
	const toggleDirectionBtn = document.getElementById('serial-toggle-direction')
	if (toggleDirectionBtn) {
		toggleDirectionBtn.textContent = toolOptions.showDirection ? '隐藏箭头' : '显示箭头'
		toggleDirectionBtn.addEventListener('click', () => {
			const next = !toolOptions.showDirection
			changeOption('showDirection', next)
			toggleDirectionBtn.textContent = next ? '隐藏箭头' : '显示箭头'
		})
	}
	const sendPanel = document.getElementById('serial-send-panel')
	const toggleSendPanelBtn = document.getElementById('serial-toggle-send-panel')
	if (sendPanel && toggleSendPanelBtn) {
		sendPanel.classList.toggle('d-none', !toolOptions.showSendPanel)
		toggleSendPanelBtn.textContent = toolOptions.showSendPanel ? '隐藏发送区' : '显示发送区'
		toggleSendPanelBtn.addEventListener('click', () => {
			const next = !toolOptions.showSendPanel
			changeOption('showSendPanel', next)
			sendPanel.classList.toggle('d-none', !next)
			toggleSendPanelBtn.textContent = next ? '隐藏发送区' : '显示发送区'
		})
	}
	toolOptions.quickSendIndex = Math.min(Math.max(0, toolOptions.quickSendIndex), quickSendList.length - 1)
	quickSend.value = String(toolOptions.quickSendIndex)
	quickSend.dispatchEvent(new Event('change'))
	resetLoopSend()

	//实时修改选项
	document.getElementById('serial-timer-out').addEventListener('change', (e) => {
		changeOption('timeOut', clampInt(e.target.value, 0, 60000, DEFAULT_TOOL_OPTIONS.timeOut))
	})
	document.getElementById('serial-log-type').addEventListener('change', (e) => {
		changeOption('logType', e.target.value)
		if (e.target.value.includes('ansi')) {
			serialLogs.classList.add('ansi')
		} else {
			serialLogs.classList.remove('ansi')
		}
	})
	document.getElementById('serial-auto-scroll').addEventListener('click', function (e) {
		let autoScroll = this.innerText != '自动滚动'
		this.innerText = autoScroll ? '自动滚动' : '暂停滚动'
		changeOption('autoScroll', autoScroll)
	})
	document.getElementById('serial-send-content').addEventListener('change', function (e) {
		changeOption('sendContent', String(this.value).slice(0, MAX_QUICK_CONTENT_LENGTH))
	})
	document.getElementById('serial-add-crlf').addEventListener('change', function (e) {
		changeOption('addCRLF', this.checked)
	})
	document.getElementById('serial-hex-send').addEventListener('change', function (e) {
		changeOption('hexSend', this.checked)
	})
	document.getElementById('serial-loop-send').addEventListener('change', function (e) {
		changeOption('loopSend', this.checked)
		resetLoopSend()
	})
	document.getElementById('serial-loop-send-time').addEventListener('change', function (e) {
		changeOption('loopSendTime', clampInt(this.value, 1, 3600000, DEFAULT_TOOL_OPTIONS.loopSendTime))
		resetLoopSend()
	})

	document.querySelectorAll('#serial-options .input-group input,#serial-options .input-group select').forEach((item) => {
		item.addEventListener('change', async (e) => {
			if (serialState !== SERIAL_STATES.OPEN) {
				return
			}
			//未找到API可以动态修改串口参数,先关闭再重新打开
			await runSerialOp(async () => {
				await closeSerial()
				if (serialDesiredOpen) {
					await openSerial()
				}
			})
		})
	})

	//重制发送循环时钟
	function resetLoopSend() {
		clearInterval(serialloopSendTimer)
		if (toolOptions.loopSend) {
			serialloopSendTimer = setInterval(() => {
				if (serialState !== SERIAL_STATES.OPEN || !serialPort?.writable) {
					return
				}
				send().catch((err) => addLogErr(err?.message ?? String(err)))
			}, toolOptions.loopSendTime)
		}
	}

	//清空
	document.getElementById('serial-clear').addEventListener('click', (e) => {
		logGeneration++
		logQueue.length = 0
		serialLogs.replaceChildren()
		resetDeviceTimeSortState()
	})
	//复制
	document.getElementById('serial-copy').addEventListener('click', (e) => {
		let text = getLogsPlainText()
		if (text) {
			copyText(text)
		}
	})
	//保存
	document.getElementById('serial-save').addEventListener('click', (e) => {
		saveLogsHtml(buildLogsHtmlDocument())
	})
	const saveTxtBtn = document.getElementById('serial-save-txt')
	if (saveTxtBtn) {
		saveTxtBtn.addEventListener('click', () => {
			let text = getLogsPlainText()
			if (text) {
				saveText(alignIwInExportedText(text))
			}
		})
	}
	//发送
	document.getElementById('serial-send').addEventListener('click', (e) => {
		send()
	})

	const serialToggle = document.getElementById('serial-open-or-close')
	const serialLogs = document.getElementById('serial-logs')
	setSerialState(serialPort ? SERIAL_STATES.CLOSED : SERIAL_STATES.NO_PORT)

	//选择串口
	document.getElementById('serial-select-port').addEventListener('click', async () => {
		// 客户端授权
		try {
			const port = await navigator.serial.requestPort()
			await runSerialOp(async () => {
				await closeSerial()
				serialPort = port
				serialStatuChange(true)
				if (serialDesiredOpen) {
					await openSerial()
				}
			})
		} catch (e) {
			console.error('获取串口权限出错' + e.toString())
		}
	})

	//关闭串口
	async function closeSerial() {
		if (serialState === SERIAL_STATES.CLOSING || serialState === SERIAL_STATES.CLOSED || serialState === SERIAL_STATES.NO_PORT) {
			setSerialState(serialPort ? SERIAL_STATES.CLOSED : SERIAL_STATES.NO_PORT)
			return
		}
		setSerialState(SERIAL_STATES.CLOSING)
		clearTimeout(serialTimer)
		if (reader) {
			try {
				await reader.cancel()
			} catch {}
		}
		try {
			if (serialPort && (serialPort.readable || serialPort.writable)) {
				await serialPort.close()
			}
		} catch {}
		setSerialState(serialPort ? SERIAL_STATES.CLOSED : SERIAL_STATES.NO_PORT)
	}

	//打开串口
	async function openSerial() {
		if (!serialPort) {
			showMsg('请先选择串口')
			return
		}
		if (serialState === SERIAL_STATES.OPEN || serialState === SERIAL_STATES.OPENING) {
			return
		}
		setSerialState(SERIAL_STATES.OPENING)
		const SerialOptions = normalizeSerialOptions({
			baudRate: Number.parseInt(get('serial-baud'), 10),
			dataBits: Number.parseInt(get('serial-data-bits'), 10),
			stopBits: Number.parseInt(get('serial-stop-bits'), 10),
			parity: get('serial-parity'),
			bufferSize: Number.parseInt(get('serial-buffer-size'), 10),
			flowControl: get('serial-flow-control'),
		})
		try {
			await serialPort.open(SerialOptions)
			setSerialState(SERIAL_STATES.OPEN)
			localStorage.setItem('serialOptions', JSON.stringify(SerialOptions))
			readData().catch((e) => addLogErr(e?.message ?? e?.toString?.() ?? String(e)))
		} catch (e) {
			setSerialState(SERIAL_STATES.CLOSED)
			showMsg('打开串口失败:' + e.toString())
		}
	}

	//打开或关闭串口
	serialToggle.addEventListener('click', async () => {
		if (!serialPort) {
			showMsg('请先选择串口')
			return
		}

		await runSerialOp(async () => {
			if (serialState === SERIAL_STATES.OPEN || serialState === SERIAL_STATES.OPENING) {
				serialDesiredOpen = false
				await closeSerial()
				return
			}
			serialDesiredOpen = true
			await openSerial()
		})
	})

	//设置读取元素
	function get(id) {
		return document.getElementById(id).value
	}
	function set(id, value) {
		return (document.getElementById(id).value = value)
	}

	//修改参数并保存
	function changeOption(key, value) {
		toolOptions = normalizeToolOptions({ ...toolOptions, [key]: value })
		localStorage.setItem('toolOptions', JSON.stringify(toolOptions))
	}

	//串口事件监听
	navigator.serial.addEventListener('connect', (e) => {
		serialStatuChange(true)
		if (serialDesiredOpen || !serialPort) {
			serialPort = e.port
		}
		//未主动关闭连接的情况下,设备重插,自动重连
		if (serialDesiredOpen) {
			runSerialOp(() => openSerial())
		}
	})
	navigator.serial.addEventListener('disconnect', (e) => {
		if (!serialPort || e.port === serialPort) {
			serialStatuChange(false)
			runSerialOp(() => closeSerial())
		}
	})
	function serialStatuChange(statu) {
		const container = document.getElementById('serial-status')
		const alert = document.createElement('div')
		alert.className = statu ? 'alert alert-success' : 'alert alert-danger'
		alert.role = 'alert'
		alert.textContent = statu ? '设备已连接' : '设备已断开'
		container.replaceChildren(alert)
	}
	//串口数据收发
	async function send() {
		let content = document.getElementById('serial-send-content').value
		if (!content) {
			addLogErr('发送内容为空')
			return
		}
		if (toolOptions.hexSend) {
			await sendHex(content)
		} else {
			await sendText(content)
		}
	}

	//发送HEX到串口
	async function sendHex(hex) {
		const value = hex.replace(/\s+/g, '')
		if (/^[0-9A-Fa-f]+$/.test(value) && value.length % 2 === 0) {
			let data = []
			for (let i = 0; i < value.length; i = i + 2) {
				data.push(parseInt(value.substring(i, i + 2), 16))
			}
			await writeData(Uint8Array.from(data))
		} else {
			addLogErr('HEX格式错误:' + hex)
		}
	}

	//发送文本到串口
	async function sendText(text) {
		const encoder = new TextEncoder()
		await writeData(encoder.encode(text))
	}

	//写串口数据
	async function writeData(data) {
		if (!serialPort || !serialPort.writable) {
			addLogErr('请先打开串口再发送数据')
			return
		}
		const writer = serialPort.writable.getWriter()
		if (toolOptions.addCRLF) {
			data = new Uint8Array([...data, 0x0d, 0x0a])
		}
		try {
			await writer.write(data)
			addLog(data, false)
		} catch (e) {
			addLogErr(e?.message ?? e?.toString?.() ?? String(e))
		} finally {
			try {
				writer.releaseLock()
			} catch {}
		}
	}

	//读串口数据
	async function readData() {
		while (serialState === SERIAL_STATES.OPEN && serialPort?.readable) {
			reader = serialPort.readable.getReader()
			try {
				while (serialState === SERIAL_STATES.OPEN) {
					const { value, done } = await reader.read()
					if (done) {
						break
					}
					if (value) {
						dataReceived(value)
					}
				}
			} catch (error) {
				if (serialState === SERIAL_STATES.OPEN) {
					addLogErr(error?.message ?? error?.toString?.() ?? String(error))
				}
			} finally {
				try {
					reader.releaseLock()
				} catch {}
			}
		}
	}

	//串口分包合并
	function dataReceived(data) {
		serialData.push(...data)
		if (toolOptions.timeOut == 0) {
			if (worker) {
				worker.postMessage({ type: 'uart_receive', data: serialData })
			}
			addLog(serialData, true)
			serialData = []
			return
		}
		//清除之前的时钟
		clearTimeout(serialTimer)
		serialTimer = setTimeout(() => {
			if (worker) {
				worker.postMessage({ type: 'uart_receive', data: serialData })
			}
			//超时发出
			addLog(serialData, true)
			serialData = []
		}, toolOptions.timeOut)
	}
	var ansi_up = new AnsiUp()
	function alignIwEspLog(text) {
		return String(text).replace(/(^|\r?\n)([IW])\s*(?=\()/g, '$1$2 ')
	}
	//添加日志
	function addLog(data, isReceive = true) {
		let classname = 'text-primary'
		let form = '→'
		if (isReceive) {
			classname = 'text-success'
			form = '←'
		}
		if (!toolOptions.logType.includes('hex') && (toolOptions.logType.includes('ansi') || toolOptions.logType.includes('text'))) {
			const dataText = alignIwEspLog(textdecoder.decode(Uint8Array.from(data)))
			const prefixParts = []
			if (toolOptions.showTime) {
				prefixParts.push(formatDate(new Date()))
			}
			if (toolOptions.showDirection) {
				prefixParts.push(form)
			}
			const prefix = prefixParts.length > 0 ? prefixParts.join(' ') + ' ' : ''
			for (const rawLine of dataText.split(/\r?\n/)) {
				const line = rawLine
				if (!line) {
					continue
				}
				const container = document.createElement('div')
				const sortKey = getDeviceSortKeyFromLine(line)
				if (sortKey != null) {
					container.dataset.sortKey = String(sortKey)
				}
				const title = document.createElement('span')
				title.className = classname
				title.textContent = prefix
				container.appendChild(title)
				if (toolOptions.logType.includes('ansi')) {
					const body = document.createElement('span')
					body.innerHTML = ansi_up.ansi_to_html(line)
					container.appendChild(body)
				} else {
					container.appendChild(document.createTextNode(line))
				}
				enqueueLogNode(container)
			}
			return
		}

		let newmsg = ''
		if (toolOptions.logType.includes('hex')) {
			let dataHex = []
			for (const d of data) {
				//转16进制并补0
				dataHex.push(('0' + d.toString(16).toLocaleUpperCase()).slice(-2))
			}
			if (toolOptions.logType.includes('&')) {
				newmsg += 'HEX:'
			}
			newmsg += dataHex.join(' ') + '<br/>'
		}
		if (toolOptions.logType.includes('text')) {
			let dataText = alignIwEspLog(textdecoder.decode(Uint8Array.from(data)))
			if (toolOptions.logType.includes('&')) {
				newmsg += 'TEXT:'
			}
			//转义HTML标签,防止内容被当作标签渲染
			newmsg += HTMLEncode(dataText)
		}
		if (toolOptions.logType.includes('ansi')) {
			const dataText = alignIwEspLog(textdecoder.decode(Uint8Array.from(data)))
			const html = ansi_up.ansi_to_html(dataText)
			newmsg += html
		}
		const prefixParts = []
		if (toolOptions.showTime) {
			prefixParts.push(formatDate(new Date()))
		}
		if (toolOptions.showDirection) {
			prefixParts.push(form)
		}
		const prefix = prefixParts.length > 0 ? prefixParts.join(' ') + ' ' : ''
		const template = '<div><span class="' + classname + '">' + prefix + '</span>' + newmsg + '</div>'
		let tempNode = document.createElement('div')
		tempNode.innerHTML = template
		enqueueLogNode(tempNode)
	}
	//HTML转义
	function HTMLEncode(html) {
		var temp = document.createElement('div')
		temp.textContent != null ? (temp.textContent = html) : (temp.innerText = html)
		var output = temp.innerHTML
		temp = null
		return output
	}
	//HTML反转义
	function HTMLDecode(text) {
		var temp = document.createElement('div')
		temp.innerHTML = text
		var output = temp.innerText || temp.textContent
		temp = null
		return output
	}
	//系统日志
	function addLogErr(msg) {
		let time = toolOptions.showTime ? formatDate(new Date()) + ' ' : ''
		const container = document.createElement('div')
		const title = document.createElement('span')
		title.className = 'text-danger'
		title.textContent = time + '系统消息'
		container.appendChild(title)
		container.appendChild(document.createElement('br'))
		container.appendChild(document.createTextNode(String(msg)))
		enqueueLogNode(container)
	}

	//复制文本
	function getLogsPlainText() {
		const parts = []
		for (const el of Array.from(serialLogs.children)) {
			const t = String(el.innerText || '').replace(/\n+$/g, '')
			if (t) {
				parts.push(t)
			}
		}
		return parts.join('\n')
	}
	function alignIwInExportedText(text) {
		return String(text).replace(/(^|\n)(\d{2}:\d{2}:\d{2}\.\d{3}\s+)?([←→]\s+)?([IW])\s+(?=\()/g, '$1$2$3$4\t')
	}
	function buildLogsHtmlForClipboard() {
		const isAnsi = serialLogs.classList.contains('ansi')
		const style = `font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;white-space:pre-wrap;word-break:break-all;${
			isAnsi ? 'background:#000;color:#fff;' : ''
		}`
		return `<div style="${style}">${serialLogs.innerHTML}</div>`
	}
	function copyText(text) {
		const alignedText = alignIwInExportedText(text)
		if (navigator.clipboard?.write && window.ClipboardItem) {
			const plain = new Blob([alignedText], { type: 'text/plain;charset=utf-8' })
			const html = new Blob([buildLogsHtmlForClipboard()], { type: 'text/html;charset=utf-8' })
			navigator.clipboard
				.write([new ClipboardItem({ 'text/plain': plain, 'text/html': html })])
				.then(() => showMsg('已复制到剪贴板'))
				.catch(() => {
					fallbackCopyText(alignedText)
				})
			return
		}
		if (navigator.clipboard?.writeText) {
			navigator.clipboard
				.writeText(alignedText)
				.then(() => showMsg('已复制到剪贴板'))
				.catch(() => {
					fallbackCopyText(alignedText)
				})
			return
		}
		fallbackCopyText(alignedText)
	}
	function fallbackCopyText(text) {
		let textarea = document.createElement('textarea')
		textarea.value = text
		textarea.readOnly = 'readonly'
		textarea.style.position = 'absolute'
		textarea.style.left = '-9999px'
		document.body.appendChild(textarea)
		textarea.select()
		textarea.setSelectionRange(0, textarea.value.length)
		document.execCommand('copy')
		document.body.removeChild(textarea)
		showMsg('已复制到剪贴板')
	}

	//保存文本
	function saveText(text) {
		let blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
		saveAs(blob, 'serial.txt')
	}
	function saveLogsHtml(html) {
		let blob = new Blob([html], { type: 'text/html;charset=utf-8' })
		saveAs(blob, 'serial.html')
	}
	function buildLogsHtmlDocument() {
		const isAnsi = serialLogs.classList.contains('ansi')
		const css = `
			:root{color-scheme:light dark}
			body{margin:0;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;}
			#serial-logs{white-space:pre-wrap;word-break:break-all;}
			.text-success{color:#198754;}
			.text-primary{color:#0d6efd;}
			.text-danger{color:#dc3545;}
			${isAnsi ? 'body{background:#000;color:#fff;}' : ''}
		`
		const content = serialLogs.innerHTML
		return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>serial log</title><style>${css}</style></head><body><div id="serial-logs" class="${
			isAnsi ? 'ansi' : ''
		}">${content}</div></body></html>`
	}

	//下载文件
	function saveAs(blob, filename) {
		if (window.navigator.msSaveOrOpenBlob) {
			navigator.msSaveBlob(blob, filename)
		} else {
			let link = document.createElement('a')
			let body = document.body
			link.href = window.URL.createObjectURL(blob)
			link.download = filename
			// fix Firefox
			link.style.display = 'none'
			body.appendChild(link)
			link.click()
			body.removeChild(link)
			window.URL.revokeObjectURL(link.href)
		}
	}

	//弹窗
	const modalTip = new bootstrap.Modal('#model-tip')
	function showMsg(msg, title = 'Web Serial') {
		//alert(msg)
		document.getElementById('modal-title').textContent = title
		document.getElementById('modal-message').textContent = msg
		modalTip.show()
	}

	//当前时间 精确到毫秒
	function formatDate(now) {
		const hour = now.getHours() < 10 ? '0' + now.getHours() : now.getHours()
		const minute = now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes()
		const second = now.getSeconds() < 10 ? '0' + now.getSeconds() : now.getSeconds()
		const millisecond = ('00' + now.getMilliseconds()).slice(-3)
		return `${hour}:${minute}:${second}.${millisecond}`
	}

	//左右折叠
	function applySidebarExpanded(sidebarId, toggleButtonEl, expanded) {
		const sidebarEl = toggleButtonEl?.closest('.sidebar')
		const collapseEl = sidebarEl?.querySelector('.collapse')
		const iconEl = toggleButtonEl?.querySelector('i')
		if (collapseEl) {
			collapseEl.classList.toggle('show', expanded)
		}
		if (iconEl) {
			const expandedIconClass = sidebarId === 'serial-tools' ? 'bi-chevron-compact-right' : 'bi-chevron-compact-left'
			const collapsedIconClass = sidebarId === 'serial-tools' ? 'bi-chevron-compact-left' : 'bi-chevron-compact-right'
			iconEl.classList.remove(expandedIconClass, collapsedIconClass)
			iconEl.classList.add(expanded ? expandedIconClass : collapsedIconClass)
		}
	}
	document.querySelectorAll('.toggle-button').forEach((element) => {
		const sidebarId = element.closest('.sidebar')?.id
		const optionKey = sidebarId === 'serial-options' ? 'showLeftSidebar' : sidebarId === 'serial-tools' ? 'showRightSidebar' : null
		if (optionKey) {
			applySidebarExpanded(sidebarId, element, Boolean(toolOptions[optionKey]))
		}
		element.addEventListener('click', (e) => {
			const buttonEl = e.currentTarget
			const currSidebarId = buttonEl.closest('.sidebar')?.id
			const currOptionKey =
				currSidebarId === 'serial-options' ? 'showLeftSidebar' : currSidebarId === 'serial-tools' ? 'showRightSidebar' : null
			const collapseEl = buttonEl.closest('.sidebar')?.querySelector('.collapse')
			const nextExpanded = collapseEl ? !collapseEl.classList.contains('show') : true
			applySidebarExpanded(currSidebarId, buttonEl, nextExpanded)
			if (currOptionKey) {
				changeOption(currOptionKey, nextExpanded)
			}
		})
	})

	//设置名称
	const modalNewName = new bootstrap.Modal('#model-change-name')
	function changeName(callback, oldName = '') {
		set('model-new-name', oldName)
		modalNewName.show()
		document.getElementById('model-save-name').onclick = null
		document.getElementById('model-save-name').onclick = function () {
			callback(get('model-new-name'))
			modalNewName.hide()
		}
	}
})()
