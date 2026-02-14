
import requests
import random
import string

def getOne(product_id, proxies=None):
    """
    Makes a GET request to the new /products/prices_data endpoint.
    :param product_id: The URL key or product identifier for which to retrieve data.
    :param proxies: Optional dictionary of proxies (if needed).
    :return: Parsed JSON data from the new endpoint or None if an error occurred.
    """

    # New endpoint URL
    url = 'https://api.kicks.dev/v3/stockx/products/'+product_id
    
    # Headers: includes your Scrappy-API-KEY
    headers={
        'Authorization': 'sd_kRbsuYh7brcMNR5BermZnUhufKUNBnuA',
    }

    # Query parameters: pass product_id as 'url_key'
    params = {
        "currency": "CHF",
        "market": "CH",
        "display[variants]": True,
        "display[traits]": True,
        "display[identifiers]": True,
        "display[prices]": True,
    }

    try:
        # Add delay to avoid rate limiting/bot detection
        import time
        time.sleep(1.5)  # 1.5 second delay between StockX API calls
        
        # Perform a GET request
        response = requests.get(
            url,
            headers=headers,
            params=params,
            timeout=10
        )

        # Print debug info for the response
        print("Response Status Code:", response.status_code)
        #print("Response Text:", response.text)

        # Check for successful response
        if response.status_code == 200:
            data = response.json()
            #print("JSON Response Data:", data)
            return data  
        elif response.status_code == 429:
            print(f"⚠️  Rate limited by StockX API. Status code: {response.status_code}")
            print("Consider increasing delays between requests")
        elif response.status_code in [403, 503]:
            print(f"🚫 Blocked by StockX bot detection. Status code: {response.status_code}")
            print("May need to wait or use different approach")
        else:
            print(f"Failed to get product info. Status code: {response.status_code}")

    except requests.RequestException as e:
        print(f"An error occurred: {e}")
        
    return None