const empty = () => {}

const validateLatch = latchKeys => {
  if (!latchKeys) {
    return true
  }
  const latchKeysArr = latchKeys.replace(/\s/g, '').split(',')
  return latchKeysArr.reduce((prev, next) => {
    return prev && next.split('.').reduce((p, n) => p && p[n], window)
  }, true)
}

const sizeUnitMap = {
  g: 1024 * 1024 * 1024,
  m: 1024 * 1024,
  k: 1024
}
const getByteNumber = arg => {
  const argType = typeof arg
  if (argType === 'number') {
    return arg
  }
  if (argType === 'string') {
    const argMatchArr = arg.match(/^(\d+)(g|m|k)?$/i)
    if (!argMatchArr) {
      return 0
    }
    if (!argMatchArr[2]) {
      return window.parseInt(arg)
    }
    return argMatchArr[1] * sizeUnitMap[argMatchArr[2].toLowerCase()]
  }
  return 0
}

const getSaveType = type => {
  if (!type) {
    return window.LocalFileSystem.TEMPORARY
  }
  const typeArr = [window.LocalFileSystem.PERSISTENT, window.LocalFileSystem.TEMPORARY]
  return typeArr.indexOf(type) === -1 ? window.LocalFileSystem.TEMPORARY : type
}

// 方法寄存器
let store = {}
// 方法和验证值hash表
let latchRecord = {}
// 方法缓存队列
let queque = []

/**
 * 向store内注册兼容方法
 * @param  {String} name registered method name
 * @param  {String} latchKeys like 'cordova.InAppBrowser.open'
 * @param  {Function} fn=empty cordova function
 * @param  {Function} fixedFn=empty broswer function
 * @returns {Function} compatible method
 */
const register = name => (latchKeys, fn = empty, fixedFn = empty) => {
  if (store.hasOwnProperty(name)) {
    throw new Error(`${name} is registered`)
  }
  store[name] = fixedFn
  latchRecord[name] = latchKeys
  if (validateLatch(latchKeys)) {
    store[name] = fn
  } else {
    queque.push({
      name,
      latchKeys,
      fn
    })
  }
  // store[name]会被重新赋值所以会改变引用，因此必须要包裹一层function
  return (...args) => store[name](...args)
}

/**
 * 向外提供原生方法有效性验证
 * @param  {String} registered method name
 * @returns {Boolean}
 */
export const validateFn = name => !!(name && validateLatch(latchRecord[name]))

/**
 * @param  {String} target 浏览器内强制新窗口打开
 * @param  {String} option=''
 * @returns {Function} open(url) 调用后返回窗口的引用
 */
export const open = register('open')(
  'cordova.InAppBrowser.open',
  (url, target = '_blank', optionStr) => {
    let finalOptionStr = optionStr;
    try {
      if (!finalOptionStr) {
        finalOptionStr = 'toolbarposition=top,location=no,closebuttoncaption=关闭';
      } else if (optionStr.indexOf('toolbarposition=') === -1) {
        finalOptionStr += ',toolbarposition=top';
      } else if (optionStr.indexOf('location=') === -1) {
        finalOptionStr += ',location=no';
      } else if (optionStr.indexOf('closebuttoncaption=') === -1) {
        finalOptionStr += ',closebuttoncaption=关闭';
      }
    } catch (e) {
      throw e
    }
    return window.cordova.InAppBrowser.open(url, target, finalOptionStr);
  },
  (url, target, optionStr) => window.open(url, '_blank', optionStr)
)

/**
 * @param  {String} target 浏览器内强制新窗口打开
 * @param  {String} option=''
 * @returns {Function} open(url) 调用后返回窗口的引用
 */
export const generatorOpen = register('generatorOpen')(
  'cordova.InAppBrowser.open',
  (target = '_blank', optionStr) => url => open(url, target, optionStr),
  (target, optionStr) => {
    let ref = window.open('about:blank', '_blank', optionStr)
    return url => {
      ref.location.href = url
      return ref
    }
  }
)

/**
 * @returns {String} 网络类型
 */
let networkMap = null
export const getNetworkType = register('getNetworkType')(
  'navigator.connection',
  () => {
    if (!networkMap) {
      networkMap = {}
      networkMap[window.Connection.UNKNOWN] = 'unknown'
      networkMap[window.Connection.ETHERNET] = 'ethernet'
      networkMap[window.Connection.WIFI] = 'wifi'
      networkMap[window.Connection.CELL_2G] = '2g'
      networkMap[window.Connection.CELL_3G] = '3g'
      networkMap[window.Connection.CELL_4G] = '4g'
      networkMap[window.Connection.CELL] = 'cell'
      networkMap[window.Connection.NONE] = 'none'
    }
    return networkMap[window.navigator.connection.type]
  },
  () => 'unknown'
)

/**
 * @returns {Boolean}
 */
export const isOnline = register('isOnline')(
  'navigator.connection',
  () => getNetworkType() !== 'none',
  () => window.navigator.onLine
)

/**
 * @param  {String} uri
 * @returns  {Promise} resolve: Function(file), reject: Fucntion(error)
 */
const readLocalFile = register('readLocalFile')(
  'resolveLocalFileSystemURL',
  uri => {
    return new Promise((resolve, reject) => window.resolveLocalFileSystemURL(
      uri,
      fileEntry => fileEntry.file(resolve, reject),
      reject
    ))
  }
)

/**
 * 因为无法做到cordova和h5交互表现一致，请先使用takePhoto的有效性验证
 *
 * @param  {Object} option: {
 *   quality: 图片质量 20 50 100
 *   width: 缩略图宽度，必须和height一起使用
 *   height: 缩略图高度，必须和width一起使用
 * }
 * @returns  {Promise} resolve: Function(file), reject: Fucntion(error)
 */
export const takePhoto = register('takePhoto')(
  'navigator.camera.getPicture',
  (option = {}) => {
    const { quality = 50, width: targetWidth, height: targetHeight } = option
    const finalOption = {
      quality,
      destinationType: window.Camera.DestinationType.FILE_URI,
      sourceType: window.Camera.PictureSourceType.CAMERA,
      encodingType: window.Camera.EncodingType.JPEG,
      targetWidth,
      targetHeight,
      mediaType: window.Camera.MediaType.PICTURE,
      allowEdit: false, // 是否允许编辑图片
      correctOrientation: true // Corrects Android orientation quirks
    }
    return new Promise((resolve, reject) => {
      window.navigator.camera.getPicture(
        // 为了统一和getPhoto的接口，返回数组
        imageUri => readLocalFile(imageUri).then(file => resolve([file]), reject),
        reject,
        finalOption
      )
    })
  },
  () => Promise.reject(new Error('没有该方法'))
)

/**
 * 因为无法做到cordova和h5交互表现一致，请先使用getPhoto的有效性验证
 *
 * @param  {Object} option: {
 *   size: 图片个数
 *   quality: 图片质量 20 50 100
 *   width: 缩略图宽度，必须和height一起使用
 *   height: 缩略图高度，必须和width一起使用
 * }
 * @returns  {Promise} resolve: Function(file), reject: Fucntion(error)
 */
export const getPhoto = register('getPhoto')(
  'imagePicker.getPictures',
  (option = {}) => {
    const { size: maximumImagesCount = 1, quality = 50, ...others } = option
    return new Promise((resolve, reject) => {
      window.imagePicker.getPictures(
        results => {
          const filesPromise = Promise.all(results.map(imageUri => readLocalFile(imageUri)))
          filesPromise.then(
            (...args) => resolve(args),
            reject
          )
        },
        reject,
        { maximumImagesCount, quality, ...others }
      )
    })
  },
  () => Promise.reject(new Error('没有该方法'))
)

/**
 * @param  {Object} option: {
 *   type: 是否是临时存储
 *   size: 所需存储空间
 *   filename: 创建的文件名称
 * }
 * @returns  {Promise} resolve: Function(fileEnty), reject: Fucntion(error)
 */
const createLocalFile = option => {
  const { type, size, filename } = option
  return new Promise((resolve, reject) => {
    window.requestFileSystem(type, size, fs => {
      fs.root.getFile(filename, {
        create: true,
        exclusive: false
      }, resolve, reject)
    }, reject)
  })
}

/**
 * @param  {Object} option: {
 *   url: 下载资源路径
 *   filename: 下载资源名称
 *   size: 下载资源大小（字节）
 *   onProgress: Function(percent)
 *   onSuccess: Fuction(fileLocalUri, file)
 *   onError: Function(error)
 *   opener: generatorOpen(target, optionStr) 兼容异步打开的情形，同步则可忽略该参数
 * }
 */
export const download = register('download')(
  'FileTransfer',
  option => {
    let { url, filename, size, type, onProgress = empty, onSuccess = empty, onError = empty } = option

    const urlMatchArr = url.match(/^https?:\/\/.*\/(.+\.\w+)$/)
    if (!urlMatchArr) {
      onError(new Error('不是合法的路径'))
      return
    }

    const finalFilename = filename || window.decodeURIComponent(urlMatchArr[1])
    if (!finalFilename) {
      onError(new Error('请传入文件名称'))
      return
    }

    createLocalFile({
      filename: finalFilename,
      size: getByteNumber(size),
      type: getSaveType(type)
    }).then(
      fileEntry => {
        const localPath = fileEntry.toURL()
        const fileTransfer = new window.FileTransfer()
        fileTransfer.download(
          url,
          localPath,
          entry => {
            const fileUri = entry.toURL()
            readLocalFile(fileUri).then(
              file => {
                onSuccess(fileUri, file)
              },
              err => {
                onError(err)
              }
            )
          },
          onError
        )
        fileTransfer.onprogress = event => {
          onProgress(event.lengthComputable ? event.loaded / event.total : null)
        }
      },
      onError
    )
  },
  option => {
    const { url = 'about:blank', opener = open } = option
    return opener(url, '_system')
  }
)

/**
 * @param  {String} filePath
 * @param  {String} fileMIMEType
 * @returns  {Promise} resolve: Function, reject: Fucntion(error)
 */
const openLocalFile = register('openLocalFile')(
  'cordova.plugins.fileOpener2.open',
  (filePath, fileMIMEType) => {
    return new Promise((resolve, reject) => {
      window.cordova.plugins.fileOpener2.open(filePath, fileMIMEType, {
        success: resolve,
        error: reject
      })
    })
  }
)

// 暂时使用默认的临时文件存储，不保存pdf文件
// opener: generatorOpen(target, optionStr) 兼容异步打开的情形，同步则可忽略该参数
export const openPdf = register('openPdf')(
  'cordova.plugins.fileOpener2.open',
  option => {
    const { url, filename, onProgress = empty, onSuccess = empty, onError = empty } = option
    download({
      url,
      filename,
      onProgress,
      onSuccess (fileUri) {
        openLocalFile(fileUri, 'application/pdf').then(onSuccess, onError)
      },
      onErrorc (err) {
        onError(err)
      }
    })
  },
  option => {
    const { url = 'about:blank', opener = open } = option
    return opener(url, '_system')
  }
)

// 暂时使用默认的临时文件存储，不保存apk文件
export const installApk = register('installApk')(
  'cordova.plugins.fileOpener2.open',
  option => {
    const { url, filename, onProgress = empty, onSuccess = empty, onError = empty } = option
    download({
      url,
      filename,
      onProgress,
      onSuccess (fileUri) {
        openLocalFile(fileUri, 'application/vnd.android.package-archive').then(onSuccess, onError)
      },
      onError
    })
  },
  option => {
    const { url = 'about:blank' } = option
    open(url, '_system')
  }
)

// 如果有等待响应的方法则注册事件
if (queque.length !== 0) {
  document.addEventListener('deviceready', () => {
    queque.forEach(({ name, latchKeys, fn }) => {
      store[name] = validateLatch(latchKeys) ? fn : store[name]
    })
    queque = []
  })
}
