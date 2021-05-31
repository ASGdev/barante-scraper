const puppeteer = require('puppeteer')
const { Events } = require('puppeteer')
const { PuppeteerWARCGenerator, PuppeteerCapturer } = require('node-warc')
const fs = require('fs-extra')
const path = require('path')
const Downloader = require('nodejs-file-downloader')

const winston = require('winston')
 
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
	winston.format.timestamp(),
	winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: './error.log', level: 'error', timestamp: true }),
    new winston.transports.File({ filename: './info.log', level: 'info', timestamp: true }),
	new winston.transports.File({ filename: './warn.log', level: 'warn', timestamp: true }),
	new winston.transports.Console({ timestamp: true })
  ],
});

exports.run = async function (uri, outputDir, options) {
	logger.log('info', "Running " + uri)

    // Set up browser and page.
    const browser = await puppeteer.launch({ headless: false })
    let scriptOutput = null
	
	let entriesCount = 0

    try {
        const page = await browser.newPage()
        page.setViewport({ width: 1280, height: 926 })
		
		await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36')

        // Navigate to this blog post and wait a bit.
        await page.goto(uri, {waitUntil: 'load', timeout: 0})
		
		await page.waitForTimeout(2000)
		
		// get vente description
		const venteDescr = await page.$eval(".v-expansion-panel-content__wrap", 
			el => el.innerHTML)
			
		await writeVenteDescr(venteDescr)
		
		logger.log('info', "Discovery started")
		// scroll for all lots
		for(i = 0; i < 170; i++){
			await page.evaluate( () => {
			  window.scrollBy(0, 500)
			});
			
			await page.waitForTimeout(1500)
		}
		
		await page.evaluate( () => {
			window.scrollTo(0, 0)
		});
		
		logger.log('info', "Discovery finished")

		await page.waitForTimeout(30000)
		
		const prevNextLotButtons = await page.$$("button[data-v-a3103b90][data-v-2e3eafd4]")
		const nextLotButtonIsEnabled = await page.$$eval("button[data-v-a3103b90][data-v-2e3eafd4]", els => els[1].hasAttribute("disabled"))
		
		while(1){
			await page.waitForTimeout(5000)		
			
			// get lot
			const lotStr = await page.$eval("div[data-v-a43cb7ba].text-h5.mr-2", 
			el => el.textContent)
			
			const lot = lotStr.substring(6).replace(/\s/g, '');
		
			logger.log('info', "Processing lot : " + lot)
		
			// get description
			const description = await page.$eval("div[data-v-a43cb7ba].description.text-body-2.my-6",
			el => el.textContent)
			
			console.log(description)
			
			/* imagesLink 1 */
			const imagesLink = await page.$$eval("img.pswp__img", imgs => imgs.map(img => img.src))
			
			logger.log('info', "Found " + imagesLink.length + " images")

			console.log(imagesLink)
			
			/* imagesLink 2 */
			const imagesLink2 = await page.$$eval("a[itemtype=\"http://schema.org/ImageObject\"]", as => as.map(a => a.href))
			//itemtype="http://schema.org/ImageObject"
			
			logger.log('info', "Found also " + imagesLink2.length + " images")

			console.log(imagesLink2)
			
			// write links in links file
			await writeLinks(lot, imagesLink2)
			
			await writeLinksGlobal(lot, imagesLink)
			await writeLinksGlobal(lot, imagesLink2)
			
			await write(lot, description, imagesLink)
			
			const pageUrl = await page.url()
			
			const nextLotButtonIsEnabled = await page.$$eval("button[data-v-a3103b90][data-v-2e3eafd4]", els => els[1].hasAttribute("disabled"))
			logger.log('info', "Found next lot")
			
			if(nextLotButtonIsEnabled) {
				logger.log('info', "Finished (last lot : " + lot + ")")
				
				break;
			}
			
			await page.waitForTimeout(4000)
			
			await prevNextLotButtons[1].click()
		}

    } catch(e){
        logger.log('error', "Navigation error")
		console.log(e)
		logger.log('error', e)
		
		console.log(e)
		
        //await browser.close()

        return null
    }

    //await browser.close()

    return scriptOutput
};

async function writeLinks(lot, links){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing link listing for lot " + lot)
		try {
			await fs.outputJson(path.join("./output", "lot" + lot, "links.json"), { links })
			logger.log('info', "Writed link listing for lot " + lot)
			
			resolve()
		} catch (e){
			logger.log('error', "Error writing link listing for lot " + lot)
			logger.log('error', e.toString())
			console.log(e)
			reject()
		}
	})
}

async function writeLinksGlobal(lot, links){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing global link listing for lot " + lot)
		try {
			await fs.appendFile(path.join("./output", "links-global.json"), JSON.stringify({ lot, links }))
			logger.log('info', "Writed global link listing for lot " + lot)
			
			resolve()
		} catch (e){
			logger.log('error', "Error writing global link listing for lot " + lot)
			logger.log('error', e.toString())
			console.log(e)
			reject()
		}
	})
}

async function write(lot, description, links){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing file for lot " + lot)
		try {
			await fs.outputJson(path.join("./output", "lot" + lot, "data.json"), { lot, description, links })
			logger.log('info', "Writed file for lot " + lot)
			
			resolve()
		} catch (e){
			logger.log('error', "Error writing file lot " + lot)
			logger.log('error', e.toString())
			console.log(e)
			reject()
		}
	})
}

async function writeVenteDescr(desc){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing vente descr file")
		try {
			await fs.outputFile(path.join("./output", "description.htmlfragment"), desc)
			logger.log('info', "Writed vente descr file")
			
			resolve()
		} catch (e){
			logger.log('error', "Error writing vente descr file")
			logger.log('error', e.toString())
			console.log(e)
			reject()
		}
	})
}

async function downloadFile(url, numeroLot, currentCount, totalCount){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Downloading image " + currentCount + "/" + totalCount + " (" + url + ") for lot " + numeroLot)
		const downloader = new Downloader({
			url: url,    
			directory: path.join("./output", "lot" + numeroLot)          
		})
		
		try {
			await downloader.download()
			
			logger.log('info', "Downloaded image " + currentCount + "/" + totalCount + " (" + url + ") for lot " + numeroLot)
			resolve()
		} catch (error) {
			logger.log('error', "Error downloading image " + currentCount + "/" + totalCount + " (" + url + ") for lot " + numeroLot)
			logger.log('error', error)
			reject()
		}
	})
}

async function getFileName(url){
	return new Promise(async (resolve, reject) => {
		const regexp = /.*\/(.*)\.html/

		const match = url.match(regexp)
		
		if(match[1]){
			resolve(match[1])
		} else {
			resolve(Date.now().toString)
		}
	})
}

async function dbConnect(){
	try {
		await client.connect()
	} catch (e) {
		console.log(e)
	}
}

dbConnect()

//this.run("https://www.interencheres.com/vehicules/vente-de-vehicules-de-collection-291407/", "./output")
this.run("https://www.interencheres.com/meubles-objets-art/archeologie-prehistoire-288251/", "./output")

process.on('uncaughtException', function(err) {
	logger.log('error', "Handling uncaughtException")
	logger.log('error', err)
}) 
