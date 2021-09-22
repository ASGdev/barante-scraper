//v7
const puppeteer = require('puppeteer')
const { Events } = require('puppeteer')
const { PuppeteerWARCGenerator, PuppeteerCapturer } = require('node-warc')
const fs = require('fs-extra')
const path = require('path')
const Downloader = require('nodejs-file-downloader')
const filenamifyUrl = require('filenamify-url')
const process = require('process')

const winston = require('winston')

exports.run = async function (uri, outputDir, options) {
	logger.log('info', "Running " + uri)

    // Set up browser and page.
    const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] })
    let scriptOutput = null
	
	let processedLotCount = 0
	let expectedLotCount = 0

    try {
        const page = await browser.newPage()

		await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36')

        // Navigate to this blog post and wait a bit.
        await page.goto(uri, {waitUntil: 'load', timeout: 0})
		
		await page.waitForTimeout(2000)
		
		// get vente description
		const venteDescr = await page.$eval(".v-expansion-panel-content__wrap", 
			el => el.innerHTML)
			
		await writeVenteDescr(venteDescr, outputDir)
		
		// interception to save json data
		await page.setRequestInterception(true)
		page.on('request', request => {
			request.continue();
		});
		
		page.on('response', async(response) => {
			const request = response.request();
			if (request.method() == "GET" && response.url().startsWith("https://search.prod-indb.io/v1/search")){
				logger.log('info', "Found api data for " + request.url())
				const content = await response.json()
				writeJsonApiData(content, outputDir)
			}
		})
		
		logger.log('info', "Discovery started")
		// scroll for all lots
		for(i = 1; i < 20; i++){
			await page.evaluate( () => {
				window.scrollBy(0, 800)
			});

			process.stdout.write("Discover progress : " + i + "/150\r");  // needs return '/r'
			
			await page.waitForTimeout(1500)
		}
		
		console.log("");
		
		const resultCount = await page.$$(".wrapper.v-card.v-sheet.v-sheet--outlined.theme--light.elevation-0.wrapper--gallery.wrapper--transparent.ma-2")
		console.log("Found " + resultCount.length + " lots")
		logger.log('info', "Found " + resultCount.length + " lots")
		
		expectedLotCount  = await page.$eval(".container.pa-0", el => {
			const raw = el.children[1].textContent
			
			return raw.match(/^([0-9]*) lots/)[1]
		})
		
		console.log("Expected " + expectedLotCount + " lots")
		logger.log('info', "Expected " + expectedLotCount + " lots")
		
		//const lastLotNumber = await 
		
		await page.evaluate( () => {
			window.scrollTo(0, 0)
		})
		
		logger.log('info', "Discovery finished")

		await page.waitForTimeout(2000)
		
		await page.evaluate( () => {
			document.querySelector("#page-1 a").click()
		})

		let isNextPage = true;
		while(1){
			await page.waitForTimeout(2000)
			
			if(isNextPage){
				await page.evaluate( () => {
					document.querySelector("#paginated-list-wrapper-top > div.mr-n1.ml-n1.d-flex.flex-wrap.flex-grow-1.flex-shrink-1.flex-basis-auto").firstChild.lastChild.click()
				})
			
				await page.waitForTimeout(2000)
				
				isNextPage = false;
			}

			// get lot
			let lotStr = "lot" + Date.now().toString()
			let lot = lotStr
			try {
				lotStr = await page.$eval(".text-h5.mr-2", el => el.textContent)
				lot = lotStr.substring(6).replace(/\s/g, '');
			} catch(e){
				console.log("No lot name found")
			}

			logger.log('info', "Processing lot : " + lot)
		
			// get description
			const description = await page.$eval(".description.text-body-2.my-6",
			el => el.textContent)
			
			console.log(description)
			
			/* imagesLink 1 */
			const imagesLink = await page.$$eval("img.pswp__img", imgs => imgs.map(img => img.src))
			
			logger.log('info', "Found " + imagesLink.length + " images for pass 1")

			console.log(imagesLink)
			
			/* imagesLink 2 */
			const imagesLink2 = await page.$$eval("a[itemtype=\"http://schema.org/ImageObject\"]", as => as.map(a => a.href))
			//itemtype="http://schema.org/ImageObject"
			
			logger.log('info', "Found also " + imagesLink2.length + " images for pass 2")

			console.log(imagesLink2)
			
			// now remove duplicates
			let uniquesSet = new Set([...imagesLink, ...imagesLink2])
			const uniquesArr = Array.from(uniquesSet)
			
			logger.log('info', "Kept " + uniquesArr.length + " images")
			console.log(uniquesArr)
			
			await writeLinksGlobal(lot, uniquesArr, outputDir)
			
			// write links in links file
			await writeLinks(lot, uniquesArr, outputDir)	
			
			/*let progress = 1
			for(const link of uniquesArr){
				try {
					await downloadFile(link, lot, progress, uniquesArr.length, outputDir)
				
					await page.waitForTimeout(1500)
				} catch(e){
					logger.log('error', "Error downloading " + link)
				}
				
				progress++
			}*/
			
			await write(lot, description, uniquesArr, outputDir)
			processedLotCount++
			
			logger.log('info', "Processed lot " + lot + " : " + processedLotCount + "/" + expectedLotCount)
				
			console.log("**************************************")
			console.log("Processed lot " + lot + " : " + processedLotCount + "/" + expectedLotCount)
			console.log("**************************************")
			
			const pageUrl = await page.url()

			const nextLotButtonIsDisabled = await page.$eval(".navigation button:last-child", el => el.hasAttribute("disabled"))
			const nextLotButton = await page.$(".navigation button:last-child")			
			
			if(nextLotButtonIsDisabled) {
				console.log("No next lot");
				logger.log('info', "Finished page");
				// close lot
				const closeLot = await page.$("#app > div.v-dialog__content.v-dialog__content--active > div > div > div.sale-item__panel.d-flex > div > div.flex-grow-1.item-details__content > div.content__top.d-flex.justify-space-between.align-center.px-3 > button.v-btn.v-btn--icon.v-btn--round.theme--light.v-size--default");
				await closeLot.click();
				
				await page.waitFor(3000);
				
				// if button is disabled, return and check for new page
				const nextPageButton = await page.$(".v-pagination li:last-child button")
				
				const disabledProp = await nextPageButton.getProperty("disabled");
				const disabled = await disabledProp.jsonValue();
				
				if(!disabled){
					console.log("next page detected")
					isNextPage = true;
					// got to next page
					await nextPageButton.click();
				} else {
					logger.log('info', "Finished sale (last lot : " + lot + ")")
			
					logger.log('info', "Processed lot " + processedLotCount + "/" + expectedLotCount)
				
					break;
				}
			} else {	
				await page.waitForTimeout(1000)
				
				logger.log('info', "Found next lot")
				
				await nextLotButton.click()
			}
		}

    } catch(e){
        logger.log('error', "Navigation error")
		console.log(e)
		logger.log('error', e)
		
		console.log("Processed lots count : " + processedLotCount)
		console.log("Expected lots count : " + expectedLotCount)
		
		logger.log('info', "Processed " + processedLotCount + " lots, expected " + expectedLotCount)
		
        await browser.close()

        return null
    }
	
	console.log("Processed lots count : " + processedLotCount)
	console.log("Expected lots count : " + expectedLotCount)
	
	logger.log('info', "Processed " + processedLotCount + " lots, expected " + expectedLotCount)

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

async function writeJsonApiData(data, out){
	return new Promise(async (resolve, reject) => {
		logger.log('info', "Writing json api data")
		try {
			await fs.outputJson(path.join(out, "api-data-" + Date.now().toString() + ".json"), data)
			logger.log('info', "Writed json api data ")
			
			resolve()
		} catch (e){
			logger.log('error', "Error writing json api data")
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
			resolve(Date.now().toString())
		}
	})
}

const _url = process.argv[2]
console.log("Running " + _url)

const _output = filenamifyUrl(_url) + "-disco-" + Date.now().toString()

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
