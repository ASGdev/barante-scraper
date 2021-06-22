const puppeteer = require('puppeteer')
const { Events } = require('puppeteer')
const { PuppeteerWARCGenerator, PuppeteerCapturer } = require('node-warc')
const fs = require('fs-extra')
const path = require('path')
const Downloader = require('nodejs-file-downloader')
const filenamifyUrl = require('filenamify-url')

const winston = require('winston')

exports.run = async function (uri, outputDir, options) {
	logger.log('info', "Running " + uri)

    // Set up browser and page.
    const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] })
    let scriptOutput = null
	
	let entriesCount = 0

    try {
        const page = await browser.newPage()
        //page.setViewport({ width: 1280, height: 926 })
		
		await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36')

        // Navigate to this blog post and wait a bit.
        await page.goto(uri, {waitUntil: 'load', timeout: 0})
		
		await page.waitForTimeout(2000)
		
		// get vente description
		const venteDescr = await page.$eval(".v-expansion-panel-content__wrap", 
			el => el.innerHTML)
			
		await writeVenteDescr(venteDescr, outputDir)
		
		logger.log('info', "Discovery started")
		// scroll for all lots
		for(i = 0; i < 200; i++){
			await page.evaluate( () => {
				window.scrollBy(0, 600)
			});
			
			await page.waitForTimeout(1500)
		}
		
		await page.evaluate( () => {
			window.scrollTo(0, 0)
		});
		
		logger.log('info', "Discovery finished")

		await page.waitForTimeout(2000)
		
		await page.evaluate( () => {
			document.querySelector("#page-1 a").click()
		});
		
		const prevNextLotButtons = await page.$$("button[data-v-a3103b90][data-v-2e3eafd4]")
		const nextLotButtonIsEnabled = await page.$$eval("button[data-v-a3103b90][data-v-2e3eafd4]", els => els[1].hasAttribute("disabled"))
		
		while(1){
			await page.waitForTimeout(1500)

			// get lot
			let lotStr = "lot" + Date.now().toString()
			try {
				lotStr = await page.$eval(".text-h5.mr-2", el => el.textContent)
			} catch(e){
				console.log("Not lot name found")
			}
			
			const lot = lotStr.substring(6).replace(/\s/g, '');
		
			logger.log('info', "Processing lot : " + lot)
		
			// get description
			const description = await page.$eval(".description.text-body-2.my-6",
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
			
			await writeLinksGlobal(lot, imagesLink, outputDir)
			await writeLinksGlobal(lot, imagesLink2, outputDir)
			
			// write links in links file
			await writeLinks(lot, imagesLink2, outputDir)

			// download images 1
			const totalCount = imagesLink.length
			let currentCount = 1
			for(const link of imagesLink){
				try {
					await downloadFile(link, lot, currentCount, totalCount, outputDir)
				
					await page.waitForTimeout(2000)
				} catch(e){
					logger.log('error', "Error downloading " + link)
				}
				
				currentCount++
			}
			
			// download images 2
			const totalCount2 = imagesLink2.length
			let currentCount2 = 1
			for(const link of imagesLink2){
				try {
					await downloadFile(link, lot, currentCount2, totalCount2, outputDir)
				
					await page.waitForTimeout(2000)
				} catch(e){
					logger.log('error', "Error downloading " + link)
				}
				
				currentCount++
			}
			
			await write(lot, description, imagesLink, outputDir)
			
			const pageUrl = await page.url()

			const nextLotButtonIsEnabled = await page.$$eval("button[data-v-a3103b90][data-v-2e3eafd4]", els => els[1].hasAttribute("disabled"))
			logger.log('info', "Found next lot")
			
			if(nextLotButtonIsEnabled) {
				logger.log('info', "Finished (last lot : " + lot + ")")
				
				break;
			}
			
			await page.waitForTimeout(1000)
			
			await prevNextLotButtons[1].click()
		}

    } catch(e){
        logger.log('error', "Navigation error")
		console.log(e)
		logger.log('error', e)
		
        await browser.close()

        return null
    }

    await browser.close()

    return scriptOutput
};

async function writeLinks(lot, links, out){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing link listing for lot " + lot)
		try {
			await fs.outputJson(path.join(out, "lot" + lot, "links.json"), { links })
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

async function writeLinksGlobal(lot, links, out){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing global link listing for lot " + lot)
		try {
			await fs.appendFile(path.join(out, "links-global.json"), JSON.stringify({ lot, links }))
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

async function write(lot, description, links, out){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing file for lot " + lot)
		try {
			await fs.outputJson(path.join(out, "lot" + lot, "data.json"), { lot, description, links })
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

async function writeVenteDescr(desc, out){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing vente descr file")
		try {
			await fs.outputFile(path.join(out, "description.htmlfragment"), desc)
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

async function downloadFile(url, numeroLot, currentCount, totalCount, out){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Downloading image " + currentCount + "/" + totalCount + " (" + url + ") for lot " + numeroLot)
		const downloader = new Downloader({
			url: url,    
			directory: path.join(out, "lot" + numeroLot)          
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

/*async function dbConnect(){
	try {
		await client.connect()
	} catch (e) {
		console.log(e)
	}
}

dbConnect()*/

const _url = process.argv[2]
console.log("Running " + _url)

const _output = filenamifyUrl(_url) + "-" + Date.now().toString()

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
	winston.format.timestamp(),
	winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: './' + _output + '/error.log', level: 'error', timestamp: true }),
    new winston.transports.File({ filename: './' + _output + '/info.log', level: 'info', timestamp: true }),
	new winston.transports.File({ filename: './' + _output + '/warn.log', level: 'warn', timestamp: true }),
	new winston.transports.Console({ timestamp: true })
  ],
});

this.run(_url, path.join("./", _output))

process.on('uncaughtException', function(err) {
	logger.log('error', "Handling uncaughtException")
	logger.log('error', err)
}) 
