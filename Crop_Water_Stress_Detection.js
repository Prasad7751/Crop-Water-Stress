var geometry = 
    /* color: #98ff00 */
    /* shown: false */
    /* displayProperties: [
      {
        "type": "rectangle"
      }
    ] */
    ee.Geometry.Polygon(
        [[[75.81946831574568, 21.192136987863876],
          [75.81946831574568, 21.115932376357243],
          [75.90598564973006, 21.115932376357243],
          [75.90598564973006, 21.192136987863876]]], null, false);
		  
function maskS2clouds(image) {
  var qa = image.select('QA60');

  // Bits 10 and 11 are clouds and cirrus, respectively.
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(mask);
}

//Add Sentinel-2 data and map LSWI

var dataset = ee.ImageCollection("COPERNICUS/S2_SR").map(maskS2clouds).map(function(image){
  var lswi = image.normalizedDifference(['B8', 'B11']).rename('LSWI');
  return image.addBands(lswi);
});

var startYear = 2020;
var endYear = 2021;

var startDate = ee.Date.fromYMD(startYear, 1, 1);
var endDate = ee.Date.fromYMD(endYear, 12, 31);

dataset = dataset.filterBounds(geometry)
                 .filterDate(startDate, endDate).select("LSWI");

// Create NDVI composite for every month
var years = ee.List.sequence(startYear,endYear);
var months = ee.List.sequence(1,12);

var monthlyLSWI =  ee.ImageCollection.fromImages(
  years.map(function (y) { 
    return months.map(function(m) {
      var monthly = dataset
        .filter(ee.Filter.calendarRange(y, y, "year"))
        .filter(ee.Filter.calendarRange(m, m, "month"))
        .mean(); 
      return monthly
        .set("year", y) 
        .set("month", m) 
        .set("system:time_start", ee.Date.fromYMD(y, m, 15));}); })
  .flatten());
print('monthlyLSWI',monthlyLSWI)


//LSWI maximum value composition
var MonthlyMAX =  ee.ImageCollection.fromImages(months
  .map(function (m) {
    var maxLSWI = monthlyLSWI.filter(ee.Filter.eq("month", m))
      .reduce(ee.Reducer.percentile({percentiles: [90]}));
  return maxLSWI
    .set("month", m);})
  .flatten());

print (MonthlyMAX, 'MonthlyMAX');
Map.addLayer (MonthlyMAX.first().clip(geometry),  {min:-1, max:1,  'palette': ['red','yellow', 'green']}, 'MonthlyMAX');

// Water Stress - I need to use monthly max 
var WS = monthlyLSWI.map(function(image) {
  var img = image.select('LSWI').clip(geometry);
  return image.addBands(image.expression(
  "(1+LSWI)/(1+max)",{
    "LSWI" : img,
    "max" : ee.Image(MonthlyMAX.filter(ee.Filter.eq('month', image.get('month'))).first()),
  })
  .rename('WS')).copyProperties(img,['system:time_start','system:time_end']);
});

print(WS.first().getInfo(), 'Water Stress First')
Map.addLayer(WS.select('WS').first(), {min:0, max:1, palette: ['green', 'yellow', 'white', 'red']}, 'Water Stress')
Map.centerObject(geometry, 12)

var clipped_WS = WS.mean().clip(geometry).select('WS');

var WS_Vis = {
  min: 0.0,
  max: 1.0,
  palette: [
'blue', 'white'
  ],
};

// Map.addLayer(clipped_WS,  WS_Vis, 'WS Mean');

var WSTimeSeries = ui.Chart.image.seriesByRegion(
    WS, geometry, ee.Reducer.mean(), 'WS', 500, 'system:time_start', 'label')
        .setChartType('ScatterChart')
        .setOptions({trendlines: {0: {color: 'CC0000'}},lineWidth: 1,pointSize: 3,
          title: 'Water Stress Time Series',
          vAxis: {title: 'Water Stress'},
          hAxis: {format: 'YYYY-MMM'},
                   series: {
            0: {color: '023B01'}, 
           
}});
// Display.
print(WSTimeSeries);

// Add Legend

var palette = ['blue', 'white'];

function createColorBar(titleText, palette, min, max) {
  // Legend Title
  var title = ui.Label({
    value: titleText, 
    style: {fontWeight: 'bold', textAlign: 'center', stretch: 'horizontal'}});

  // Colorbar
  var legend = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: {
      bbox: [0, 0, 1, 0.1],
      dimensions: '200x20',
      format: 'png', 
      min: 0, max: 1,
      palette: palette},
    style: {stretch: 'horizontal', margin: '8px 8px', maxHeight: '40px'},
  });
  
  // Legend Labels
  var labels = ui.Panel({
    widgets: [
      ui.Label(min, {margin: '4px 10px',textAlign: 'left', stretch: 'horizontal'}),
      ui.Label((min+max)/2, {margin: '4px 20px', textAlign: 'center', stretch: 'horizontal'}),
      ui.Label(max, {margin: '4px 10px',textAlign: 'right', stretch: 'horizontal'})],
    layout: ui.Panel.Layout.flow('horizontal')});
  
  // Create a panel with all 3 widgets
  var legendPanel = ui.Panel({
    widgets: [title, legend, labels],
    style: {position: 'bottom-center', padding: '8px 15px'}
  })
  return legendPanel
}
// Call the function to create a colorbar legend  
var colorBar = createColorBar('Water Stress', palette, 0, 1)

Map.add(colorBar)

var lswi = dataset.median().clip(geometry);

// Export to drive
Export.image.toDrive({
  image: lswi,
  description: 'LSWI',
  scale: 10,
  region: geometry,
  maxPixels: 1e10
});

// Export to drive
Export.image.toDrive({
  image: MonthlyMAX.first(),
  description: 'LSWIMax',
  scale: 10,
  region: geometry,
  maxPixels: 1e10
});

// Export to drive
Export.image.toDrive({
  image: WS.select('WS').first(),
  description: 'WS',
  scale: 10,
  region: geometry,
  maxPixels: 1e10
});
