import axios from 'axios'
import qs from 'qs'
import { toPoint, dmsToDd } from './mgrs'
import store from '../store'
const server_url = store.getters.server_url

export default {
  isId(entry) { return entry.category === 'id' },
  isMagic(entry) { return entry.category === 'magicword' },
  isSensor(entry) { return entry.category === 'sensor' },
  concatFinalQS (magicWordsQS = 0, sensorsQS = 0, idsQS = 0) {
    // concat the final query string using join.
    // This automagically prevents ANDs from being appended and causing errors.
    let typesOfQueryStrings = [magicWordsQS, sensorsQS, idsQS]
    const queryString = typesOfQueryStrings.filter(type => type.length > 0);
    return queryString.join(' AND ')
  },
  generateVideoFilter(filterArr) {
    // Target the magic word and ID field (ignores sensors)
    const targets = ['magicword', 'id']

    // Filter out only the values which can be used for video queries
    let tmpArr =  filterArr.filter(filter => targets.includes(filter.category))

    // Magic Words
    let magicWordsQS = this.generateVideoString(tmpArr.filter(this.isMagic))

    // IDs
    let idsQS = this.generateVideoString(tmpArr.filter(this.isId))

    return this.concatFinalQS (magicWordsQS, idsQS)
  },
  generateImageryFilter(filterArr) {
    // Magic Words
    let magicWordsQS = this.generateDDString(filterArr.filter(this.isMagic))

    // Sensors
    let sensorsQS = this.generateSensorString(filterArr.filter(this.isSensor))

    // IDs
    let idsQS = this.generateIdString(filterArr.filter(this.isId))

    return this.concatFinalQS (magicWordsQS, sensorsQS, idsQS)
  },
  generateVideoString(idsAndMagicWords) {
    let tmpString = ''
    for (let [index, filter] of idsAndMagicWords.entries()) {
      let prependValue
        = (index === 0) ? ''
        : ' OR '
      tmpString += prependValue + `filename LIKE '%${filter.value.toUpperCase()}%'`
    }
    return (tmpString.length > 0) ? `(${tmpString})` : ''
  },
  generateIdString(ids) {
    let tmpString = ''
    for (let [index, filter] of ids.entries()) {
      let prependValue
        = (index === 0) ? ''
        : ' OR '
      tmpString += prependValue + `${filter.type} LIKE '%${filter.value.toUpperCase()}%'`
    }
    return (tmpString.length > 0) ? `(${tmpString})` : ''
  },
  generateSensorString(sensors) {
    let tmpString = ''
    for (let [index, filter] of sensors.entries()) {
      let prependValue
        = (index === 0) ? ''
        : ' OR '
      tmpString += prependValue + `${filter.type} LIKE '%${filter.value.toUpperCase()}%'`
    }
    return (tmpString.length > 0) ? `(${tmpString})` : ''
  },
  generateDDString(magicWords) {
    let ddPattern = /(\-?\d{1,2}[.]?\d*)[\s+|,?]\s*(\-?\d{1,3}[.]?\d*)/
    let dmsPattern = /(\d{1,2})[^\d]*(\d{2})[^\d]*(\d{2}[.]?\d*)[^\d]*\s*([n|N|s|S])[^\w]*(\d{1,3})[^\d]*(\d{2})[^d]*(\d{2}[.]?\d*)[^\d]*\s*([e|E|w|W])/
    let mgrsPattern = /(\d{1,2})([a-zA-Z])[^\w]*([a-zA-Z])([a-zA-Z])[^\w]*(\d{5})[^\w]*(\d{5})/

    let lat, lng = null, magicWordString = ''

    for (let [index, filter] of magicWords.entries()) {
      let prependValue
        = (index === 0) ? ''
        : ' OR '

      // DD
      if (filter.value.match(ddPattern)) {
        lat = parseFloat(RegExp.$1);
        lng = parseFloat(RegExp.$2);
        magicWordString += prependValue + 'INTERSECTS(ground_geom,POINT(' + lng + '+' + lat + '))'
      }

      // DMS
      else if (filter.value.match(dmsPattern)) {
        lat = dmsToDd( RegExp.$1, RegExp.$2, RegExp.$3, RegExp.$4 )
        lng = dmsToDd( RegExp.$5, RegExp.$6, RegExp.$7, RegExp.$8 )
        magicWordString += prependValue + 'INTERSECTS(ground_geom,POINT(' + lng + '+' + lat + '))'
      }

      // MGRS
      else if (filter.value.match(mgrsPattern)) {
        let coords = toPoint(RegExp.$1 + RegExp.$2 + RegExp.$3 + RegExp.$4 + RegExp.$5 + RegExp.$6)
        lat = coords[1]
        lng = coords[0]
        magicWordString += prependValue + 'INTERSECTS(ground_geom,POINT(' + lng + '+' + lat + '))'
      }

      // Title
      else {
        magicWordString += prependValue + `image_id LIKE '%${filter.value.toUpperCase()}%'`
      }
    }
    return (magicWordString.length > 0) ? `(${magicWordString})` : ''
  },
  WFSQuery( startIndex = 0, maxFeatures = 30, filter = '') {
    const wfsParams = {
      maxFeatures: maxFeatures,
      outputFormat: 'JSON',
      request: 'GetFeature',
      service: 'WFS',
      startIndex: startIndex,
      typeName: 'omar:raster_entry',
      version: '1.1.0',
      sortBy: 'acquisition_date :D',
    }

    // return the promise so it can be asynced and reused throughout the app
    return axios
      .get(server_url + '/omar-wfs/wfs?&' + qs.stringify(wfsParams) + '&filter=' + encodeURI(filter), {timeout: 3000})
      .then(res => {
        return res.data.features
      })
      .catch(error => {
        console.log(error)
      })
  },
  videoQuery(startIndex = 0, maxFeatures = 30, filter = '') {
    const wfsParams = {
      maxFeatures: maxFeatures,
      service: 'WFS',
      startIndex: startIndex,
      version: '1.1.0',
      request: 'GetFeature',
      typeName: 'omar:video_data_set',
      resultType: 'results',
      outputFormat: 'JSON'
    }

    return axios
      .get(server_url + '/omar-wfs/wfs?&' + qs.stringify(wfsParams) + '&filter=' + encodeURI(filter), {timeout: 3000})
      .then(res => {
        let length = res.data.features.length;
        for (let i=0; i < length; i++ ){
          const id = res.data.features[i].properties.id

          // strip everything away leaving filename
          // because regex is the devil and this is cleaner
          // split divides url by /, pop returns last, replace modifies filetype
          const videoNameMp4 = res.data.features[i].properties.filename.split('/').pop().replace(/mpg/i, 'mp4')
          const videoFileType = res.data.features[i].properties.filename.split('.').pop()

          // Build thumbnail url using a more dynamnic approach
          // It's not a link directly to the image.  It's a service that responds with the image
          const thumbUrl = `${server_url}/omar-stager/videoDataSet/getThumbnail?id=${id}&w=348&h=300&type=jpeg`

          // WEIRD BUG with backtick where the last ) is not rendered properly... Researched for a while.
          const playerUrl = `${server_url}/omar-video-ui?filter=in(${id})`

          // Build final url and append to response keeping unified object intact
          res.data.features[i].properties.video_url = `${server_url}/videos/${videoNameMp4}`

          // Append requestThumbnailUrl to video response for UI
          res.data.features[i].properties.request_thumbnail_url = thumbUrl

          // Create a short file name (no file extension)
          // used for screenshot naming
          // this.videoName = videoNameMp4.split('.').slice(0, -1).join('.')

          // Append omar-video-ui to video response for UI
          res.data.features[i].properties.player_url = playerUrl

          // Append filetype to video response for UI
          res.data.features[i].properties.type = videoFileType

          // Append name to video response for UI
          res.data.features[i].properties.video_name = videoNameMp4

        }
        return res.data.features
      })
      .catch(error => {
        console.log(error)
        // this.errored = true
      })
  },
  returnThumbnail(properties, size) {
    let thumbUrl = ''

    if (properties.type === 'mpg') {
      thumbUrl = properties.request_thumbnail_url
    } else {
      thumbUrl = server_url + '/omar-oms/imageSpace/getThumbnail?' + qs.stringify({
        entry: properties.entry_id,
        filename: properties.filename,
        id: properties.id,
        outputFormat: 'jpeg',
        padThumbnail: false,
        size: size,
        transparent: false
      });
    }
    return thumbUrl
  },
  openTLVTab (imageId) {
    const tlvUrl = `/tlv/?filter=in(${imageId})`
    window.open(tlvUrl, '_blank');
  }
}
