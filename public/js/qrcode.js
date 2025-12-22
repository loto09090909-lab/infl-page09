/*
 * QRCode generator (MIT License)
 * Based on https://github.com/kazuhikoarase/qrcode-generator
 * Simplified loader for browser usage.
 */
(function () {
    function qrcode(typeNumber, errorCorrectionLevel) {
        var _typeNumber = typeNumber;
        var _errorCorrectionLevel = errorCorrectionLevel;
        var _modules = null;
        var _moduleCount = 0;
        var _dataCache = null;
        var _dataList = [];

        var PAD0 = 0xEC;
        var PAD1 = 0x11;

        var _this = {};

        _this.addData = function (data) {
            var newData = new QR8bitByte(data);
            _dataList.push(newData);
            _dataCache = null;
        };

        _this.isDark = function (row, col) {
            if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
                throw new Error(row + ',' + col);
            }
            return _modules[row][col];
        };

        _this.getModuleCount = function () {
            return _moduleCount;
        };

        _this.make = function () {
            if (_typeNumber < 1) {
                var typeNumber = 1;
                for (typeNumber = 1; typeNumber < 40; typeNumber++) {
                    var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
                    var buffer = new QRBitBuffer();
                    for (var i = 0; i < _dataList.length; i++) {
                        var data = _dataList[i];
                        buffer.put(data.getMode(), 4);
                        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
                        data.write(buffer);
                    }
                    var totalDataCount = 0;
                    for (var j = 0; j < rsBlocks.length; j++) {
                        totalDataCount += rsBlocks[j].dataCount;
                    }
                    if (buffer.getLengthInBits() <= totalDataCount * 8) {
                        _typeNumber = typeNumber;
                        break;
                    }
                }
            }
            makeImpl(false, getBestMaskPattern());
        };

        _this.createDataURL = function (cellSize, margin) {
            cellSize = cellSize || 4;
            margin = typeof margin === 'number' ? margin : cellSize * 4;
            var size = _moduleCount * cellSize + margin * 2;
            var canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#111111';
            for (var row = 0; row < _moduleCount; row++) {
                for (var col = 0; col < _moduleCount; col++) {
                    if (_this.isDark(row, col)) {
                        ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
                    }
                }
            }
            return canvas.toDataURL('image/png');
        };

        function makeImpl(test, maskPattern) {
            _moduleCount = _typeNumber * 4 + 17;
            _modules = new Array(_moduleCount);
            for (var row = 0; row < _moduleCount; row++) {
                _modules[row] = new Array(_moduleCount);
                for (var col = 0; col < _moduleCount; col++) {
                    _modules[row][col] = null;
                }
            }

            setupPositionProbePattern(0, 0);
            setupPositionProbePattern(_moduleCount - 7, 0);
            setupPositionProbePattern(0, _moduleCount - 7);
            setupPositionAdjustPattern();
            setupTimingPattern();
            setupTypeInfo(test, maskPattern);

            if (_typeNumber >= 7) {
                setupTypeNumber(test);
            }

            if (_dataCache === null) {
                _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
            }

            mapData(_dataCache, maskPattern);
        }

        function setupPositionProbePattern(row, col) {
            for (var r = -1; r <= 7; r++) {
                if (row + r <= -1 || _moduleCount <= row + r) continue;
                for (var c = -1; c <= 7; c++) {
                    if (col + c <= -1 || _moduleCount <= col + c) continue;
                    if ((0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
                        _modules[row + r][col + c] = true;
                    } else {
                        _modules[row + r][col + c] = false;
                    }
                }
            }
        }

        function setupTimingPattern() {
            for (var r = 8; r < _moduleCount - 8; r++) {
                if (_modules[r][6] !== null) continue;
                _modules[r][6] = (r % 2 === 0);
            }
            for (var c = 8; c < _moduleCount - 8; c++) {
                if (_modules[6][c] !== null) continue;
                _modules[6][c] = (c % 2 === 0);
            }
        }

        function setupPositionAdjustPattern() {
            var pos = QRUtil.getPatternPosition(_typeNumber);
            for (var i = 0; i < pos.length; i++) {
                for (var j = 0; j < pos.length; j++) {
                    var row = pos[i];
                    var col = pos[j];
                    if (_modules[row][col] !== null) continue;
                    for (var r = -2; r <= 2; r++) {
                        for (var c = -2; c <= 2; c++) {
                            if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
                                _modules[row + r][col + c] = true;
                            } else {
                                _modules[row + r][col + c] = false;
                            }
                        }
                    }
                }
            }
        }

        function setupTypeNumber(test) {
            var bits = QRUtil.getBCHTypeNumber(_typeNumber);
            for (var i = 0; i < 18; i++) {
                var mod = (!test && ((bits >> i) & 1) === 1);
                _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
                _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
            }
        }

        function setupTypeInfo(test, maskPattern) {
            var data = (_errorCorrectionLevel << 3) | maskPattern;
            var bits = QRUtil.getBCHTypeInfo(data);
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) === 1);
                if (i < 6) {
                    _modules[i][8] = mod;
                } else if (i < 8) {
                    _modules[i + 1][8] = mod;
                } else {
                    _modules[_moduleCount - 15 + i][8] = mod;
                }
            }
            for (var j = 0; j < 15; j++) {
                var mod2 = (!test && ((bits >> j) & 1) === 1);
                if (j < 8) {
                    _modules[8][_moduleCount - j - 1] = mod2;
                } else if (j < 9) {
                    _modules[8][15 - j - 1 + 1] = mod2;
                } else {
                    _modules[8][15 - j - 1] = mod2;
                }
            }
            _modules[_moduleCount - 8][8] = !test;
        }

        function mapData(data, maskPattern) {
            var inc = -1;
            var row = _moduleCount - 1;
            var bitIndex = 7;
            var byteIndex = 0;

            for (var col = _moduleCount - 1; col > 0; col -= 2) {
                if (col === 6) col--;
                while (true) {
                    for (var c = 0; c < 2; c++) {
                        if (_modules[row][col - c] === null) {
                            var dark = false;
                            if (byteIndex < data.length) {
                                dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
                            }
                            var mask = QRUtil.getMask(maskPattern, row, col - c);
                            if (mask) dark = !dark;
                            _modules[row][col - c] = dark;
                            bitIndex--;
                            if (bitIndex === -1) {
                                byteIndex++;
                                bitIndex = 7;
                            }
                        }
                    }
                    row += inc;
                    if (row < 0 || _moduleCount <= row) {
                        row -= inc;
                        inc = -inc;
                        break;
                    }
                }
            }
        }

        function getBestMaskPattern() {
            var minLostPoint = 0;
            var pattern = 0;
            for (var i = 0; i < 8; i++) {
                makeImpl(true, i);
                var lostPoint = QRUtil.getLostPoint(_this);
                if (i === 0 || minLostPoint > lostPoint) {
                    minLostPoint = lostPoint;
                    pattern = i;
                }
            }
            return pattern;
        }

        function createData(typeNumber, errorCorrectionLevel, dataList) {
            var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
            var buffer = new QRBitBuffer();
            for (var i = 0; i < dataList.length; i++) {
                var data = dataList[i];
                buffer.put(data.getMode(), 4);
                buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
                data.write(buffer);
            }
            var totalDataCount = 0;
            for (var j = 0; j < rsBlocks.length; j++) {
                totalDataCount += rsBlocks[j].dataCount;
            }
            if (buffer.getLengthInBits() > totalDataCount * 8) {
                throw new Error('code length overflow.');
            }
            if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
                buffer.put(0, 4);
            }
            while (buffer.getLengthInBits() % 8 !== 0) {
                buffer.putBit(false);
            }
            while (true) {
                if (buffer.getLengthInBits() >= totalDataCount * 8) break;
                buffer.put(PAD0, 8);
                if (buffer.getLengthInBits() >= totalDataCount * 8) break;
                buffer.put(PAD1, 8);
            }
            return createBytes(buffer, rsBlocks);
        }

        function createBytes(buffer, rsBlocks) {
            var offset = 0;
            var maxDcCount = 0;
            var maxEcCount = 0;
            var dcdata = new Array(rsBlocks.length);
            var ecdata = new Array(rsBlocks.length);
            for (var r = 0; r < rsBlocks.length; r++) {
                var dcCount = rsBlocks[r].dataCount;
                var ecCount = rsBlocks[r].totalCount - dcCount;
                maxDcCount = Math.max(maxDcCount, dcCount);
                maxEcCount = Math.max(maxEcCount, ecCount);
                dcdata[r] = new Array(dcCount);
                for (var i = 0; i < dcdata[r].length; i++) {
                    dcdata[r][i] = 0xff & buffer.buffer[i + offset];
                }
                offset += dcCount;
                var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
                var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
                var modPoly = rawPoly.mod(rsPoly);
                ecdata[r] = new Array(rsPoly.getLength() - 1);
                for (var j = 0; j < ecdata[r].length; j++) {
                    var modIndex = j + modPoly.getLength() - ecdata[r].length;
                    ecdata[r][j] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
                }
            }
            var totalCodeCount = 0;
            for (var k = 0; k < rsBlocks.length; k++) {
                totalCodeCount += rsBlocks[k].totalCount;
            }
            var data = new Array(totalCodeCount);
            var index = 0;
            for (var i2 = 0; i2 < maxDcCount; i2++) {
                for (var r2 = 0; r2 < rsBlocks.length; r2++) {
                    if (i2 < dcdata[r2].length) {
                        data[index++] = dcdata[r2][i2];
                    }
                }
            }
            for (var i3 = 0; i3 < maxEcCount; i3++) {
                for (var r3 = 0; r3 < rsBlocks.length; r3++) {
                    if (i3 < ecdata[r3].length) {
                        data[index++] = ecdata[r3][i3];
                    }
                }
            }
            return data;
        }

        return _this;
    }

    var QRMode = {
        MODE_8BIT_BYTE: 1 << 2,
    };

    var QRErrorCorrectionLevel = {
        L: 1,
        M: 0,
        Q: 3,
        H: 2,
    };

    function QR8bitByte(data) {
        this.mode = QRMode.MODE_8BIT_BYTE;
        this.data = data;
    }
    QR8bitByte.prototype = {
        getLength: function () {
            return this.data.length;
        },
        write: function (buffer) {
            for (var i = 0; i < this.data.length; i++) {
                buffer.put(this.data.charCodeAt(i), 8);
            }
        },
        getMode: function () {
            return this.mode;
        },
    };

    function QRBitBuffer() {
        this.buffer = [];
        this.length = 0;
    }
    QRBitBuffer.prototype = {
        get: function (index) {
            var bufIndex = Math.floor(index / 8);
            return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) === 1;
        },
        put: function (num, length) {
            for (var i = 0; i < length; i++) {
                this.putBit(((num >>> (length - i - 1)) & 1) === 1);
            }
        },
        getLengthInBits: function () {
            return this.length;
        },
        putBit: function (bit) {
            var bufIndex = Math.floor(this.length / 8);
            if (this.buffer.length <= bufIndex) {
                this.buffer.push(0);
            }
            if (bit) {
                this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
            }
            this.length++;
        },
    };

    function QRPolynomial(num, shift) {
        if (num.length === undefined) {
            throw new Error(num.length + '/' + shift);
        }
        var offset = 0;
        while (offset < num.length && num[offset] === 0) {
            offset++;
        }
        this.num = new Array(num.length - offset + (shift || 0));
        for (var i = 0; i < num.length - offset; i++) {
            this.num[i] = num[i + offset];
        }
    }
    QRPolynomial.prototype = {
        getAt: function (index) {
            return this.num[index];
        },
        getLength: function () {
            return this.num.length;
        },
        multiply: function (e) {
            var num = new Array(this.getLength() + e.getLength() - 1);
            for (var i = 0; i < this.getLength(); i++) {
                for (var j = 0; j < e.getLength(); j++) {
                    num[i + j] ^= QRUtil.gexp(QRUtil.glog(this.getAt(i)) + QRUtil.glog(e.getAt(j)));
                }
            }
            return new QRPolynomial(num, 0);
        },
        mod: function (e) {
            if (this.getLength() - e.getLength() < 0) {
                return this;
            }
            var ratio = QRUtil.glog(this.getAt(0)) - QRUtil.glog(e.getAt(0));
            var num = new Array(this.getLength());
            for (var i = 0; i < this.getLength(); i++) {
                num[i] = this.getAt(i);
            }
            for (var j = 0; j < e.getLength(); j++) {
                num[j] ^= QRUtil.gexp(QRUtil.glog(e.getAt(j)) + ratio);
            }
            return new QRPolynomial(num, 0).mod(e);
        },
    };

    var QRUtil = {
        PATTERN_POSITION_TABLE: [
            [],
            [6, 18],
            [6, 22],
            [6, 26],
            [6, 30],
            [6, 34],
            [6, 22, 38],
            [6, 24, 42],
            [6, 26, 46],
            [6, 28, 50],
            [6, 30, 54],
            [6, 32, 58],
            [6, 34, 62],
            [6, 26, 46, 66],
            [6, 26, 48, 70],
            [6, 26, 50, 74],
            [6, 30, 54, 78],
            [6, 30, 56, 82],
            [6, 30, 58, 86],
            [6, 34, 62, 90],
            [6, 28, 50, 72, 94],
            [6, 26, 50, 74, 98],
            [6, 30, 54, 78, 102],
            [6, 28, 54, 80, 106],
            [6, 32, 58, 84, 110],
            [6, 30, 58, 86, 114],
            [6, 34, 62, 90, 118],
            [6, 26, 50, 74, 98, 122],
            [6, 30, 54, 78, 102, 126],
            [6, 26, 52, 78, 104, 130],
            [6, 30, 56, 82, 108, 134],
            [6, 34, 60, 86, 112, 138],
            [6, 30, 58, 86, 114, 142],
            [6, 34, 62, 90, 118, 146],
            [6, 30, 54, 78, 102, 126, 150],
            [6, 24, 50, 76, 102, 128, 154],
            [6, 28, 54, 80, 106, 132, 158],
            [6, 32, 58, 84, 110, 136, 162],
            [6, 26, 54, 82, 110, 138, 166],
            [6, 30, 58, 86, 114, 142, 170],
        ],
        G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
        G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
        G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
        getBCHTypeInfo: function (data) {
            var d = data << 10;
            while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
                d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15)));
            }
            return ((data << 10) | d) ^ QRUtil.G15_MASK;
        },
        getBCHTypeNumber: function (data) {
            var d = data << 12;
            while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
                d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18)));
            }
            return (data << 12) | d;
        },
        getBCHDigit: function (data) {
            var digit = 0;
            while (data !== 0) {
                digit++;
                data >>>= 1;
            }
            return digit;
        },
        getPatternPosition: function (typeNumber) {
            return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
        },
        getMask: function (maskPattern, i, j) {
            switch (maskPattern) {
                case 0: return (i + j) % 2 === 0;
                case 1: return i % 2 === 0;
                case 2: return j % 3 === 0;
                case 3: return (i + j) % 3 === 0;
                case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
                case 5: return ((i * j) % 2 + (i * j) % 3) === 0;
                case 6: return (((i * j) % 2 + (i * j) % 3) % 2) === 0;
                case 7: return (((i + j) % 2 + (i * j) % 3) % 2) === 0;
                default: throw new Error('bad maskPattern:' + maskPattern);
            }
        },
        getErrorCorrectPolynomial: function (errorCorrectLength) {
            var a = new QRPolynomial([1], 0);
            for (var i = 0; i < errorCorrectLength; i++) {
                a = a.multiply(new QRPolynomial([1, QRUtil.gexp(i)], 0));
            }
            return a;
        },
        getLengthInBits: function (mode, type) {
            if (1 <= type && type < 10) {
                return mode === QRMode.MODE_8BIT_BYTE ? 8 : 0;
            } else if (type < 27) {
                return mode === QRMode.MODE_8BIT_BYTE ? 16 : 0;
            } else if (type < 41) {
                return mode === QRMode.MODE_8BIT_BYTE ? 16 : 0;
            } else {
                throw new Error('type:' + type);
            }
        },
        getLostPoint: function (qrCode) {
            var moduleCount = qrCode.getModuleCount();
            var lostPoint = 0;
            for (var row = 0; row < moduleCount; row++) {
                for (var col = 0; col < moduleCount; col++) {
                    var sameCount = 0;
                    var dark = qrCode.isDark(row, col);
                    for (var r = -1; r <= 1; r++) {
                        if (row + r < 0 || moduleCount <= row + r) continue;
                        for (var c = -1; c <= 1; c++) {
                            if (col + c < 0 || moduleCount <= col + c) continue;
                            if (r === 0 && c === 0) continue;
                            if (dark === qrCode.isDark(row + r, col + c)) sameCount++;
                        }
                    }
                    if (sameCount > 5) lostPoint += (3 + sameCount - 5);
                }
            }
            for (var row2 = 0; row2 < moduleCount - 1; row2++) {
                for (var col2 = 0; col2 < moduleCount - 1; col2++) {
                    var count = 0;
                    if (qrCode.isDark(row2, col2)) count++;
                    if (qrCode.isDark(row2 + 1, col2)) count++;
                    if (qrCode.isDark(row2, col2 + 1)) count++;
                    if (qrCode.isDark(row2 + 1, col2 + 1)) count++;
                    if (count === 0 || count === 4) lostPoint += 3;
                }
            }
            for (var row3 = 0; row3 < moduleCount; row3++) {
                for (var col3 = 0; col3 < moduleCount - 6; col3++) {
                    if (qrCode.isDark(row3, col3) && !qrCode.isDark(row3, col3 + 1) && qrCode.isDark(row3, col3 + 2) && qrCode.isDark(row3, col3 + 3) && qrCode.isDark(row3, col3 + 4) && !qrCode.isDark(row3, col3 + 5) && qrCode.isDark(row3, col3 + 6)) {
                        lostPoint += 40;
                    }
                }
            }
            for (var col4 = 0; col4 < moduleCount; col4++) {
                for (var row4 = 0; row4 < moduleCount - 6; row4++) {
                    if (qrCode.isDark(row4, col4) && !qrCode.isDark(row4 + 1, col4) && qrCode.isDark(row4 + 2, col4) && qrCode.isDark(row4 + 3, col4) && qrCode.isDark(row4 + 4, col4) && !qrCode.isDark(row4 + 5, col4) && qrCode.isDark(row4 + 6, col4)) {
                        lostPoint += 40;
                    }
                }
            }
            var darkCount = 0;
            for (var row5 = 0; row5 < moduleCount; row5++) {
                for (var col5 = 0; col5 < moduleCount; col5++) {
                    if (qrCode.isDark(row5, col5)) darkCount++;
                }
            }
            var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
            lostPoint += ratio * 10;
            return lostPoint;
        },
        gexp: function (n) {
            while (n < 0) n += 255;
            while (n >= 256) n -= 255;
            return QRUtil.EXP_TABLE[n];
        },
        glog: function (n) {
            if (n < 1) throw new Error('glog(' + n + ')');
            return QRUtil.LOG_TABLE[n];
        },
        EXP_TABLE: new Array(256),
        LOG_TABLE: new Array(256),
    };

    for (var i = 0; i < 8; i++) {
        QRUtil.EXP_TABLE[i] = 1 << i;
    }
    for (var i2 = 8; i2 < 256; i2++) {
        QRUtil.EXP_TABLE[i2] = QRUtil.EXP_TABLE[i2 - 4] ^ QRUtil.EXP_TABLE[i2 - 5] ^ QRUtil.EXP_TABLE[i2 - 6] ^ QRUtil.EXP_TABLE[i2 - 8];
    }
    for (var i3 = 0; i3 < 255; i3++) {
        QRUtil.LOG_TABLE[QRUtil.EXP_TABLE[i3]] = i3;
    }

    function QRRSBlock(totalCount, dataCount) {
        this.totalCount = totalCount;
        this.dataCount = dataCount;
    }
    QRRSBlock.getRSBlocks = function (typeNumber, errorCorrectionLevel) {
        var rsBlock = QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + errorCorrectionLevel];
        if (rsBlock === undefined) {
            throw new Error('bad rs block @ typeNumber:' + typeNumber + '/errorCorrectionLevel:' + errorCorrectionLevel);
        }
        var list = [];
        for (var i = 0; i < rsBlock.length / 3; i++) {
            var count = rsBlock[i * 3 + 0];
            var totalCount = rsBlock[i * 3 + 1];
            var dataCount = rsBlock[i * 3 + 2];
            for (var j = 0; j < count; j++) {
                list.push(new QRRSBlock(totalCount, dataCount));
            }
        }
        return list;
    };
    QRRSBlock.RS_BLOCK_TABLE = [
        [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
        [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
        [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
        [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
        [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
        [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
        [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
        [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
        [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
        [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
        [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
        [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
        [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
        [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
        [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
        [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
        [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
        [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
        [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
        [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
        [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
        [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
        [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
        [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
        [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
        [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
        [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
        [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
        [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
        [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
        [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
        [17, 145, 115, 1, 146, 116], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
        [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
    ];

    window.qrcode = qrcode;
    window.QRErrorCorrectionLevel = QRErrorCorrectionLevel;
})();
